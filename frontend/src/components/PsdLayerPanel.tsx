"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, PsdLayerNode } from "@/lib/api";
import { useOverrideEditor } from "./OverrideEditorContext";

// レイヤーID -> {parent, siblings(ツリー順), node} の索引。ソロ/スクロール計算に使う。
interface LayerIndex {
  byId: Map<string, PsdLayerNode>;
  parentOf: Map<string, string | null>;
  siblingsOf: Map<string, string[]>; // 親ID(またはROOT) -> 子IDのツリー順
  rootSiblings: string[];
  allIds: string[];
}

const ROOT = "__root__";

function buildIndex(tree: PsdLayerNode[]): LayerIndex {
  const byId = new Map<string, PsdLayerNode>();
  const parentOf = new Map<string, string | null>();
  const siblingsOf = new Map<string, string[]>();
  const allIds: string[] = [];

  function walk(nodes: PsdLayerNode[], parent: string | null) {
    const sibKey = parent ?? ROOT;
    siblingsOf.set(sibKey, nodes.map((n) => n.id));
    for (const n of nodes) {
      byId.set(n.id, n);
      parentOf.set(n.id, parent);
      allIds.push(n.id);
      if (n.children && n.children.length) walk(n.children, n.id);
    }
  }
  walk(tree, null);
  return { byId, parentOf, siblingsOf, rootSiblings: siblingsOf.get(ROOT) || [], allIds };
}

function applyDelta(base: Set<string>, delta: Record<string, boolean>): Set<string> {
  const out = new Set(base);
  for (const [id, on] of Object.entries(delta || {})) {
    if (on) out.add(id);
    else out.delete(id);
  }
  return out;
}

// 新しい可視集合とプリセット基準集合の差分（最小デルタ）を作る。
function diffDelta(base: Set<string>, next: Set<string>, allIds: string[]): Record<string, boolean> {
  const delta: Record<string, boolean> = {};
  for (const id of allIds) {
    const inBase = base.has(id);
    const inNext = next.has(id);
    if (inBase !== inNext) delta[id] = inNext;
  }
  return delta;
}

/** PSD立ち絵のパーツ個別変更パネル。YMM4互換のレイヤー表示操作を提供する。 */
export default function PsdLayerPanel() {
  const { characterName, effectivePreset, psdLayerOverrides, setPsdLayers, tachieType } = useOverrideEditor();
  const [tree, setTree] = useState<PsdLayerNode[]>([]);
  const [baseLayers, setBaseLayers] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildIndex(tree), [tree]);

  // ツリー取得（キャラ変更時）。
  useEffect(() => {
    if (tachieType !== "psd" || !characterName) return;
    let alive = true;
    api
      .getPsdLayerTree(characterName)
      .then((r) => { if (alive) setTree(r.tree); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [tachieType, characterName]);

  // プリセット基準のレイヤー集合（デルタ抜き）を取得。
  useEffect(() => {
    if (tachieType !== "psd" || !characterName) return;
    let alive = true;
    api
      .psdPreview(characterName, { preset_name: effectivePreset || null })
      .then((r) => { if (alive) setBaseLayers(new Set(r.base_layers)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [tachieType, characterName, effectivePreset]);

  // 現在の可視集合 = 基準 + デルタ。
  const enable = useMemo(() => applyDelta(baseLayers, psdLayerOverrides), [baseLayers, psdLayerOverrides]);

  // 新しい可視集合を確定 → 最小デルタを保存。
  function commit(next: Set<string>) {
    setPsdLayers(diffDelta(baseLayers, next, index.allIds));
  }

  function toggle(id: string) {
    const next = new Set(enable);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    commit(next);
  }

  // 中クリック=ソロ: 同フォルダ内の兄弟を全て非表示にし、対象のみ表示。
  function solo(id: string) {
    const parent = index.parentOf.get(id) ?? null;
    const sibs = index.siblingsOf.get(parent ?? ROOT) || [];
    const next = new Set(enable);
    for (const sid of sibs) {
      if (sid === id) next.add(sid);
      else next.delete(sid);
    }
    commit(next);
  }

  // Ctrl/Shift+スクロール=兄弟グループの可視配列を1つシフト（クランプ／ラップなし）。
  // down(deltaY>0): new[i]=old[i-1], new[0]=false  例 [T,T,F]→[F,T,T]
  // up(deltaY<0):   new[i]=old[i+1], new[last]=false
  function shiftSiblings(id: string, down: boolean) {
    const parent = index.parentOf.get(id) ?? null;
    const sibs = index.siblingsOf.get(parent ?? ROOT) || [];
    if (sibs.length === 0) return;
    const cur = sibs.map((sid) => enable.has(sid));
    const shifted = sibs.map((_, i) => {
      const src = down ? i - 1 : i + 1;
      return src >= 0 && src < cur.length ? cur[src] : false;
    });
    const next = new Set(enable);
    sibs.forEach((sid, i) => {
      if (shifted[i]) next.add(sid);
      else next.delete(sid);
    });
    commit(next);
  }

  // パネル全体で非passive wheel を購読し、Ctrl/Shift+ホイールでシフト。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.shiftKey)) return;
      const target = (e.target as HTMLElement)?.closest?.("[data-layer-id]") as HTMLElement | null;
      if (!target) return;
      const id = target.getAttribute("data-layer-id");
      if (!id) return;
      e.preventDefault();
      shiftSiblings(id, e.deltaY > 0);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enable, index]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasDelta = Object.keys(psdLayerOverrides || {}).length > 0;

  function renderNodes(nodes: PsdLayerNode[], depth: number): React.ReactNode {
    return nodes.map((n) => {
      const visible = enable.has(n.id);
      const isCollapsed = collapsed.has(n.id);
      const delta = psdLayerOverrides && n.id in psdLayerOverrides;
      return (
        <div key={n.id}>
          <div
            data-layer-id={n.id}
            onMouseDown={(e) => {
              // 中クリック=ソロ。autoscroll を防ぐため preventDefault。
              if (e.button === 1) {
                e.preventDefault();
                solo(n.id);
              }
            }}
            className="flex items-center gap-1.5"
            style={{
              paddingLeft: `${depth * 14 + 2}px`,
              height: "22px",
              fontSize: "0.72rem",
              borderRadius: "4px",
              background: delta ? "var(--accent-dim, rgba(99,102,241,0.10))" : undefined,
              cursor: "default",
              userSelect: "none",
            }}
            title="クリック:表示切替 / 中クリック:ソロ / Ctrl・Shift+ホイール:グループ送り"
          >
            {n.is_folder ? (
              <button
                onClick={() => toggleCollapse(n.id)}
                style={{ width: "12px", fontSize: "0.6rem", color: "var(--text-faint)", flexShrink: 0 }}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
            ) : (
              <span style={{ width: "12px", flexShrink: 0 }} />
            )}
            <button
              onClick={() => toggle(n.id)}
              style={{
                width: "16px",
                flexShrink: 0,
                color: visible ? "var(--accent)" : "var(--text-faint)",
                opacity: visible ? 1 : 0.45,
              }}
              title={visible ? "表示中（クリックで非表示）" : "非表示（クリックで表示）"}
            >
              {visible ? "◉" : "○"}
            </button>
            <span
              onClick={() => toggle(n.id)}
              className="truncate"
              style={{
                color: visible ? (n.is_folder ? "var(--text-secondary)" : "var(--text-primary, #111)") : "var(--text-faint)",
                fontWeight: n.is_folder ? 700 : delta ? 700 : 400,
                flex: 1,
                minWidth: 0,
              }}
            >
              {n.name}
            </span>
          </div>
          {n.is_folder && !isCollapsed && n.children?.length > 0 && renderNodes(n.children, depth + 1)}
        </div>
      );
    });
  }

  if (tachieType !== "psd") return null;
  if (error) return <p style={{ color: "var(--em-anger)", fontSize: "0.8rem" }}>{error}</p>;

  return (
    <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: "10px" }}>
      <div className="flex items-center gap-2">
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)" }}>
          パーツ個別変更（レイヤー）
        </span>
        <span className="label-hint">
          {hasDelta ? `${Object.keys(psdLayerOverrides).length} レイヤー変更中` : "クリック表示切替 / 中クリックソロ / Ctrl+ホイール送り"}
        </span>
      </div>
      <div
        ref={containerRef}
        className="mt-2"
        style={{
          maxHeight: "340px",
          overflowY: "auto",
          overscrollBehavior: "contain",
          border: "1px solid var(--border-dim)",
          borderRadius: "6px",
          padding: "4px",
          background: "var(--bg-surface)",
        }}
      >
        {tree.length === 0 ? (
          <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", padding: "8px" }}>レイヤー読込中…</p>
        ) : (
          renderNodes(tree, 0)
        )}
      </div>
    </div>
  );
}
