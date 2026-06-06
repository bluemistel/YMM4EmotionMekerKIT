"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, VoiceInfo, TrainingRebuildResult } from "@/lib/api";
import EmotionDonut from "./EmotionDonut";

// 単一主感情ラベル（学習用）。0=中立/なし。
const EMOTIONS: { key: string; label: string }[] = [
  { key: "joy", label: "喜" },
  { key: "anger", label: "怒" },
  { key: "sadness", label: "哀" },
  { key: "happiness", label: "楽" },
  { key: "surprise", label: "驚き" },
  { key: "embarrassment", label: "照れ" },
  { key: "disgust", label: "嫌悪" },
  { key: "fear", label: "恐れ" },
  { key: "exasperation", label: "呆れ" },
];
const NEUTRAL = "__neutral__";

interface Props {
  voices: VoiceInfo[];
  projectName: string;
  onExit: () => void;
}

/** 学習データ用の高速ラベリング画面。各台詞に単一の主感情（or 中立）を付ける。
 *  キーボード: 1–9=感情, 0=中立, ↑↓=移動, Enter=保存して次。 */
export default function TrainingLabeler({ voices, projectName, onExit }: Props) {
  // voice index -> emotion key | NEUTRAL
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<TrainingRebuildResult | null>(null);
  const [storedTotal, setStoredTotal] = useState<number | null>(null);
  const [storedCounts, setStoredCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    api.getTrainingLabels().then((r) => { setStoredTotal(r.total); setStoredCounts(r.counts || {}); }).catch(() => {});
  }, []);

  // 累計（サーバ保存済み）＋当該セッションの未保存ラベルを合算してバランス表示する。
  const liveCounts = useMemo(() => {
    const merged: Record<string, number> = { ...storedCounts };
    for (const v of Object.values(labels)) {
      if (v && v !== NEUTRAL) merged[v] = (merged[v] || 0) + 1;
    }
    return merged;
  }, [storedCounts, labels]);

  const labeledCount = useMemo(
    () => Object.values(labels).filter((v) => v && v !== NEUTRAL).length,
    [labels]
  );

  const setLabel = useCallback((voiceIndex: number, key: string) => {
    setLabels((prev) => {
      const next = { ...prev };
      if (prev[voiceIndex] === key) delete next[voiceIndex]; // 同じキーで取消
      else next[voiceIndex] = key;
      return next;
    });
  }, []);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (voices.length === 0) return;
      const v = voices[cursor];
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < EMOTIONS.length) {
          setLabel(v.index, EMOTIONS[idx].key);
          setCursor((c) => Math.min(voices.length - 1, c + 1));
        }
      } else if (e.key === "0") {
        setLabel(v.index, NEUTRAL);
        setCursor((c) => Math.min(voices.length - 1, c + 1));
      } else if (e.key === "ArrowDown" || e.key === "Enter") {
        setCursor((c) => Math.min(voices.length - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        setCursor((c) => Math.max(0, c - 1));
      }
    },
    [cursor, voices, setLabel]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  async function handleSave() {
    setSaving(true);
    setMsg("");
    try {
      const payload = voices
        .filter((v) => labels[v.index])
        .map((v) => ({
          text: v.serif,
          character: v.character_name,
          emotion: labels[v.index] === NEUTRAL ? null : labels[v.index],
        }));
      if (payload.length === 0) {
        setMsg("ラベルが付いていません。");
        return;
      }
      const r = await api.addTrainingLabels(payload, projectName);
      const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
      setStoredTotal(total);
      setStoredCounts(r.counts || {});
      setLabels({}); // 保存済みは累計へ反映済みなのでセッションをリセット（二重計上防止）
      setMsg(`保存しました（このセッション ${r.written} 件 / 累計 ${total} 件）`);
    } catch (e) {
      setMsg(`保存に失敗: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    setRebuildResult(null);
    setMsg("");
    try {
      const r = await api.rebuildPersonalization();
      setRebuildResult(r);
      if (!r.trained) {
        setMsg(r.reason === "insufficient_data" ? "学習に必要なデータが不足しています（各感情に数件以上推奨）。" : "学習をスキップしました。");
      }
    } catch (e) {
      setMsg(`学習に失敗: ${(e as Error).message}`);
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="h-full flex flex-col px-6 py-5 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <button onClick={onExit} className="btn-ghost" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            ← 戻る
          </button>
          <h2 className="section-title">学習データのラベリング</h2>
          <span style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}>{projectName}</span>
        </div>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            このセッション {labeledCount}/{voices.length} 件
            {storedTotal != null && <>（累計 {storedTotal} 件）</>}
          </span>
          <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ fontSize: "0.82rem", padding: "6px 16px" }}>
            {saving ? "保存中…" : "ラベルを保存"}
          </button>
          <button onClick={handleRebuild} disabled={rebuilding} className="btn-secondary" style={{ fontSize: "0.82rem", padding: "6px 16px" }}>
            {rebuilding ? "学習中…" : "学習を再構築"}
          </button>
        </div>
      </div>

      <p style={{ fontSize: "0.76rem", color: "var(--text-faint)", marginBottom: "8px" }}>
        各台詞に最も近い「主感情」を1つ選びます（複合・強度は学習対象外、感情マッピングで補います）。
        キーボード: <strong>1–9</strong>=感情 / <strong>0</strong>=中立 / <strong>↑↓</strong>=移動 / <strong>Enter</strong>=次へ。
      </p>

      {/* 登録状況（累計＋セッション）をライブ表示してバランス良くラベリングできるようにする。 */}
      <div className="panel mb-2" style={{ padding: "8px 12px" }}>
        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600, marginBottom: "4px" }}>
          ラベル登録バランス（累計＋このセッション）
        </div>
        <EmotionDonut counts={liveCounts} />
      </div>

      {(msg || rebuildResult) && (
        <div className="mb-2" style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          {msg}
          {rebuildResult?.trained && (
            <span style={{ marginLeft: "8px", color: "var(--accent)" }}>
              学習完了：累計 {rebuildResult.total} 件
              {rebuildResult.holdout_acc != null && <>／概算一致率 {(rebuildResult.holdout_acc * 100).toFixed(0)}%</>}
            </span>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto panel" style={{ padding: "6px" }}>
        {voices.map((v, i) => {
          const sel = labels[v.index];
          const active = i === cursor;
          return (
            <div
              key={v.index}
              onClick={() => setCursor(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "7px 10px",
                borderRadius: "6px",
                background: active ? "var(--accent-soft)" : "transparent",
                borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: "0.72rem", color: "var(--text-faint)", width: "70px", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.character_name}
              </span>
              <span style={{ fontSize: "0.82rem", color: "var(--text-primary)", flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.serif}
              </span>
              <div className="flex gap-1 flex-shrink-0">
                {EMOTIONS.map((em) => {
                  const on = sel === em.key;
                  return (
                    <button
                      key={em.key}
                      onClick={(e) => { e.stopPropagation(); setLabel(v.index, em.key); }}
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: on ? 700 : 500,
                        padding: "2px 7px",
                        borderRadius: "5px",
                        border: on ? "1px solid var(--accent)" : "1px solid var(--border-dim)",
                        background: on ? "var(--accent)" : "transparent",
                        color: on ? "#fff" : "var(--text-muted)",
                        cursor: "pointer",
                      }}
                    >
                      {em.label}
                    </button>
                  );
                })}
                <button
                  onClick={(e) => { e.stopPropagation(); setLabel(v.index, NEUTRAL); }}
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: sel === NEUTRAL ? 700 : 500,
                    padding: "2px 7px",
                    borderRadius: "5px",
                    border: sel === NEUTRAL ? "1px solid var(--text-muted)" : "1px solid var(--border-dim)",
                    background: sel === NEUTRAL ? "var(--text-muted)" : "transparent",
                    color: sel === NEUTRAL ? "#fff" : "var(--text-faint)",
                    cursor: "pointer",
                  }}
                >
                  中立
                </button>
              </div>
            </div>
          );
        })}
        {voices.length === 0 && (
          <p className="text-center" style={{ padding: "32px 0", color: "var(--text-faint)", fontSize: "0.85rem" }}>
            台詞が見つかりませんでした。
          </p>
        )}
      </div>
    </div>
  );
}
