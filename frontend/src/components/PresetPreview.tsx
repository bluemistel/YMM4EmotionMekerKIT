"use client";
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from "react";
import { api, PresetPreviewInfo, PsdLayersInfo, PsdLayerNode } from "@/lib/api";
import { applyLayerDelta, effectiveVisibleLeaves } from "@/lib/psd";

interface Props {
  characterName: string;
  presetName: string;
  /** 基層となる立ち絵プリセット名（通常は config.emotion_presets.default）。
   *  指定時、基層プリセットのパーツを下に敷き、現在プリセットのパーツで
   *  フィールド単位に上書き合成して描画する。 */
  basePresetName?: string | null;
  /** パーツ個別変更（フィールド名→ファイル名）。指定時は最終合成に
   *  上書きとして反映される。 */
  overrideParts?: Record<string, string>;
  /** true のとき画像エリアをマウスホイールでカーソル位置中心に拡大できる */
  zoomable?: boolean;
  /** 右側の「パーツ一覧」を表示するか（既定 true）。左カラム統合時は false。 */
  showPartsList?: boolean;
  /** 画像ボックスを大きく表示する（カラム幅にフィット）。 */
  large?: boolean;
  /** 指定すると拡大率・表示位置をこのキーで保持し、台詞（プリセット）切替でも
   *  リセットしない（ダブルクリックでリセットは可能）。 */
  viewKey?: string;
  /** PSD立ち絵モード。サーバ側で合成した1枚のPNGを表示する。 */
  psd?: boolean;
  /** PSDレイヤーのパーツ個別変更デルタ（レイヤーID→表示/非表示）。psd 時のみ有効。 */
  psdLayerOverrides?: Record<string, boolean>;
}

// viewKey ごとにズーム状態を保持する（インスタンス再マウント・プリセット変更を跨ぐ）。
const viewStore: Record<string, { scale: number; tx: number; ty: number }> = {};

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

const RENDER_ORDER = [
  "Etc1", "Etc2", "Etc3",
  "Hair",
  "Eyebrow", "Eye", "Mouth",
  "Hair",
  "Complexion", "Body",
  "Back1", "Back2", "Back3",
];

const PART_LABELS: Record<string, string> = {
  Eyebrow: "眉",
  Eye: "目",
  Mouth: "口",
  Hair: "髪",
  Complexion: "顔色",
  Body: "体",
  Etc1: "他1",
  Etc2: "他2",
  Etc3: "他3",
  Back1: "後1",
  Back2: "後2",
  Back3: "後3",
};

export default function PresetPreview({
  characterName,
  presetName,
  basePresetName,
  overrideParts,
  zoomable = false,
  showPartsList = true,
  large = false,
  viewKey,
  psd = false,
  psdLayerOverrides,
}: Props) {
  const [merged, setMerged] = useState<PresetPreviewInfo | null>(null);
  const [presetOnly, setPresetOnly] = useState<PresetPreviewInfo | null>(null);
  // PSD: 事前ベイクしたレイヤー画像マニフェスト＋ツリー＋プリセット基準集合。
  const [psdManifest, setPsdManifest] = useState<PsdLayersInfo | null>(null);
  const [psdTree, setPsdTree] = useState<PsdLayerNode[]>([]);
  const [psdBase, setPsdBase] = useState<string[]>([]);
  const [error, setError] = useState("");
  // Cursor-anchored zoom: scale + translation (px, relative to the box).
  const [view, setView] = useState(() =>
    viewKey && viewStore[viewKey] ? { ...viewStore[viewKey] } : { scale: 1, tx: 0, ty: 0 }
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  // 保持指定があれば view 変更を store に書き出す。
  useEffect(() => {
    if (viewKey) viewStore[viewKey] = view;
  }, [view, viewKey]);
  const boxRef = useRef<HTMLDivElement>(null);
  // Drag-to-pan state (only meaningful while zoomed in).
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseTx: number; baseTy: number } | null>(null);
  // Bumped when app settings (e.g. YMM4 exe path) change, to refetch the
  // merged composite so YMM4 default 立ち絵 are reflected without a reload.
  const [settingsTick, setSettingsTick] = useState(0);

  // Serialize overrideParts for a stable effect dependency
  const overrideKey = JSON.stringify(overrideParts || {});
  const psdOverrideKey = JSON.stringify(psdLayerOverrides || {});

  // PSD: 実際に表示するリーフID集合（基準＋デルタ→祖先フォルダ可視で絞り込み）。
  // トグル/ソロ/スクロールはこの集合の再計算のみ＝バックエンド往復なしで瞬時。
  const psdVisible = useMemo(() => {
    if (!psd || !psdManifest) return new Set<string>();
    const enable = applyLayerDelta(psdBase, psdLayerOverrides);
    return effectiveVisibleLeaves(psdTree, enable, psdManifest.scheme);
  }, [psd, psdManifest, psdTree, psdBase, psdOverrideKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset zoom AND blank the image only when the previewed preset/character
  // changes — NOT when part overrides change. Keeping the previous image during
  // an overrideParts refetch holds the box height stable, so the surrounding
  // scroll position doesn't jump when editing a part.
  useEffect(() => {
    // viewKey 指定時は拡大率・位置を保持（台詞切替でリセットしない）。
    if (!viewKey) setView({ scale: 1, tx: 0, ty: 0 });
    setError("");
    setMerged(null);
    setPresetOnly(null);
  }, [characterName, presetName, basePresetName]); // eslint-disable-line react-hooks/exhaustive-deps

  // PSD: レイヤー画像マニフェスト＋ツリーを「キャラ単位で1回だけ」取得する
  // （初回ベイクのみコスト。以降のトグルは取得不要＝瞬時）。
  useEffect(() => {
    if (!psd || !characterName) return;
    let alive = true;
    setPsdManifest(null);
    Promise.all([api.getPsdLayers(characterName), api.getPsdLayerTree(characterName)])
      .then(([m, t]) => { if (alive) { setPsdManifest(m); setPsdTree(t.tree); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [psd, characterName, settingsTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // PSD: プリセット基準の可視集合（デルタ抜き・合成なし）をプリセット変更時に取得。
  useEffect(() => {
    if (!psd || !characterName) return;
    let alive = true;
    api
      .resolvePsdLayers(characterName, { preset_name: presetName || null })
      .then((r) => { if (alive) setPsdBase(r.base_layers); })
      .catch(() => {});
    return () => { alive = false; };
  }, [psd, characterName, presetName]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetZoom() {
    setView({ scale: 1, tx: 0, ty: 0 });
  }

  // Keep the scaled content covering the box (no empty gaps) for a given scale.
  function clampTranslate(tx: number, ty: number, scale: number, w: number, h: number) {
    return {
      tx: Math.max(w * (1 - scale), Math.min(0, tx)),
      ty: Math.max(h * (1 - scale), Math.min(0, ty)),
    };
  }

  // Native, non-passive wheel listener so preventDefault() actually stops the
  // page from scrolling (React's onWheel is passive). Anchors the zoom around
  // the cursor by adjusting the translation to keep the pointed-at point fixed.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !zoomable) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = box!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { scale, tx, ty } = viewRef.current;
      const contentX = (cx - tx) / scale;
      const contentY = (cy - ty) / scale;
      const next = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, scale + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
      );
      const { tx: ntx, ty: nty } = clampTranslate(
        cx - contentX * next,
        cy - contentY * next,
        next,
        rect.width,
        rect.height
      );
      setView({ scale: next, tx: ntx, ty: nty });
    }
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [zoomable, merged, psdManifest]);

  // Drag-to-pan: window-level move/up listeners are only attached while a drag
  // is in progress, anchored from the mousedown position + the base translation.
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      const box = boxRef.current;
      if (!d || !box) return;
      const rect = box.getBoundingClientRect();
      const { scale } = viewRef.current;
      const { tx, ty } = clampTranslate(
        d.baseTx + (e.clientX - d.startX),
        d.baseTy + (e.clientY - d.startY),
        scale,
        rect.width,
        rect.height
      );
      setView((v) => ({ ...v, tx, ty }));
    }
    function onUp() {
      dragRef.current = null;
      setDragging(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  function onBoxMouseDown(e: React.MouseEvent) {
    if (!zoomable || viewRef.current.scale <= 1) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseTx: viewRef.current.tx,
      baseTy: viewRef.current.ty,
    };
    setDragging(true);
  }

  // Refetch when settings change elsewhere (Settings modal / initial screen).
  useEffect(() => {
    function onChange() {
      setSettingsTick((t) => t + 1);
    }
    window.addEventListener("ymm4-settings-changed", onChange);
    return () => window.removeEventListener("ymm4-settings-changed", onChange);
  }, []);

  useEffect(() => {
    if (psd) return; // PSD は専用エフェクトで取得
    if (!characterName || !presetName) return;

    // Final composite (YMM4 default + base + preset + part overrides),
    // computed server-side so hover/inline previews always agree.
    api
      .getPresetPreviewMerged(characterName, {
        preset_name: presetName,
        base_preset_name: basePresetName ?? null,
        with_defaults: true,
        part_overrides: overrideParts && Object.keys(overrideParts).length ? overrideParts : undefined,
      })
      .then(setMerged)
      .catch((e) => setError(e.message));

    // Preset-only parts (no defaults) tell us which fields come from the
    // 表情アイテム (preset) vs the underlying 立ち絵 base — used for coloring.
    api
      .getPresetPreview(characterName, presetName, false)
      .then(setPresetOnly)
      .catch(() => {
        // non-fatal; coloring just falls back
      });
  }, [characterName, presetName, basePresetName, overrideKey, settingsTick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p style={{ color: "var(--em-anger)", fontSize: "0.8125rem" }}>{error}</p>;
  if (!psd && !merged) return null;

  // PSD: アスペクト比を保ったまま枠(3:4)に収める（高さ/幅の大きい方に合わせる contain）。
  const BOX_ASPECT = 3 / 4;
  let psdStageStyle: React.CSSProperties = { width: "100%" };
  if (psd && psdManifest) {
    const { w: cw, h: ch } = psdManifest.canvas;
    psdStageStyle =
      cw / ch >= BOX_ASPECT
        ? { width: "100%", aspectRatio: `${cw} / ${ch}` } // 横長寄り→幅に合わせる
        : { height: "100%", aspectRatio: `${cw} / ${ch}` }; // 縦長寄り→高さに合わせる
  }

  const mergedParts: Record<string, string | null> = merged?.parts || {};
  const activeParts = Object.entries(mergedParts).filter(([, v]) => v !== null);
  // フィールドが現在プリセット由来またはパーツ個別変更由来（=表情アイテム）かを示す
  const overriddenFields = new Set<string>([
    ...Object.entries(presetOnly?.parts || {}).filter(([, v]) => v !== null).map(([k]) => k),
    ...Object.entries(overrideParts || {}).filter(([, v]) => !!v).map(([k]) => k),
  ]);

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center gap-2 mb-3">
        <h3 style={{ fontSize: "0.78rem", color: "var(--text-muted)", letterSpacing: "0.04em", fontWeight: 700 }}>
          プレビュー
        </h3>
        <span style={{ fontSize: "0.8rem", color: "var(--accent)", fontWeight: 700 }}>
          {presetName}
        </span>
        {basePresetName && basePresetName !== presetName && (
          <span style={{ fontSize: "0.66rem", color: "var(--text-faint)", marginLeft: "auto" }}>
            base: {basePresetName}
          </span>
        )}
      </div>

      <div className="flex gap-5">
        <div
          ref={boxRef}
          onDoubleClick={zoomable ? resetZoom : undefined}
          onMouseDown={zoomable ? onBoxMouseDown : undefined}
          className="relative flex-shrink-0 overflow-hidden"
          style={{
            width: large ? "100%" : "180px",
            maxWidth: large ? "280px" : undefined,
            aspectRatio: large ? "3 / 4" : undefined,
            height: large ? "auto" : "240px",
            margin: large ? "0 auto" : undefined,
            background: "var(--bg-surface)",
            borderRadius: "8px",
            border: "1px solid var(--border-dim)",
            cursor: zoomable
              ? dragging
                ? "grabbing"
                : view.scale > 1
                  ? "grab"
                  : "zoom-in"
              : "default",
            overscrollBehavior: "contain",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              transformOrigin: "0 0",
              transition: dragging ? "none" : "transform 0.06s linear",
              willChange: "transform",
            }}
          >
            {psd ? (
              // PSD: 事前ベイクした各レイヤー画像を CSS で重ねる。表示/非表示は
              // psdVisible 集合で切替えるだけ（バックエンド往復なし＝瞬時）。
              psdManifest && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", ...psdStageStyle }}>
                    {psdManifest.layers.map((L, i) => (
                      <img
                        key={L.id}
                        src={api.presetImageUrl(L.path)}
                        alt={L.name}
                        draggable={false}
                        style={{
                          position: "absolute",
                          left: `${(L.left / psdManifest.canvas.w) * 100}%`,
                          top: `${(L.top / psdManifest.canvas.h) * 100}%`,
                          width: `${(L.width / psdManifest.canvas.w) * 100}%`,
                          height: `${(L.height / psdManifest.canvas.h) * 100}%`,
                          zIndex: i,
                          opacity: L.opacity,
                          mixBlendMode: L.blend as React.CSSProperties["mixBlendMode"],
                          visibility: psdVisible.has(L.id) ? "visible" : "hidden",
                        }}
                      />
                    ))}
                  </div>
                </div>
              )
            ) : (
            /* RENDER_ORDER は前面→背面の順（Etc1 が最前面、Back3 が最背面）。
                CSS z-index は大きいほど前面なので、先頭ほど高い z を割り当てる。 */
            RENDER_ORDER.map((field, i) => {
              const path = mergedParts[field];
              if (!path) return null;
              return (
                <img
                  key={`${field}-${i}`}
                  src={api.presetImageUrl(path)}
                  alt={field}
                  className="absolute inset-0 w-full h-full object-contain"
                  style={{ zIndex: RENDER_ORDER.length - i }}
                  draggable={false}
                />
              );
            }))}
          </div>
          {!psd && activeParts.length === 0 && (
            <div className="flex items-center justify-center h-full" style={{ color: "var(--text-faint)", fontSize: "0.8125rem" }}>
              パーツなし
            </div>
          )}
          {zoomable && (
            <div
              style={{
                position: "absolute",
                bottom: "4px",
                right: "6px",
                fontSize: "0.6rem",
                color: "var(--text-faint)",
                background: "#ffffffc0",
                borderRadius: "4px",
                padding: "1px 5px",
                pointerEvents: "none",
                fontFamily: "var(--font-mono)",
              }}
            >
              {view.scale.toFixed(2)}x · ホイール拡大／ドラッグ移動
            </div>
          )}
        </div>

        {showPartsList && !psd && (
        <div className="flex-1 space-y-1.5">
          <h3 style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px", letterSpacing: "0.05em" }}>パーツ一覧</h3>
          {activeParts.map(([field, path]) => {
            const isOverride = overriddenFields.has(field);
            return (
              <div key={field} className="flex items-center gap-2">
                <span style={{ width: "32px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {PART_LABELS[field] || field}
                </span>
                <span
                  className="mono-text truncate"
                  style={{
                    fontSize: "0.7rem",
                    color: isOverride ? "var(--accent)" : "var(--text-faint)",
                    fontWeight: isOverride ? 600 : 400,
                  }}
                  title={isOverride ? "表情アイテム" : "立ち絵（base）"}
                >
                  {path?.split("\\").pop() || path?.split("/").pop()}
                </span>
              </div>
            );
          })}
          {activeParts.length === 0 && (
            <p style={{ color: "var(--text-faint)", fontSize: "0.8125rem" }}>全パーツデフォルト</p>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
