"use client";

import { useState, useEffect } from "react";
import { api, AnalysisItem } from "@/lib/api";
import PresetHoverButton from "./PresetHoverButton";
import PresetPreview from "./PresetPreview";

const EMOTION_LABELS: Record<string, string> = {
  joy: "喜",
  anger: "怒",
  sadness: "哀",
  happiness: "楽",
  surprise: "驚き",
  embarrassment: "照れ",
};

interface Props {
  voiceIndex: number;
  analysisItem: AnalysisItem;
  characterName: string;
  presetNames: string[];
  availableFiles?: Record<string, string[]>;
  basePresetName?: string | null;
  onOverrideChange?: () => void;
}

const PART_FIELDS: { key: string; label: string }[] = [
  { key: "Eyebrow", label: "眉" },
  { key: "Eye", label: "目" },
  { key: "Mouth", label: "口" },
  { key: "Hair", label: "髪" },
  { key: "Complexion", label: "顔色" },
  { key: "Body", label: "体" },
  { key: "Back1", label: "後1" },
  { key: "Back2", label: "後2" },
  { key: "Back3", label: "後3" },
  { key: "Etc1", label: "他1" },
  { key: "Etc2", label: "他2" },
  { key: "Etc3", label: "他3" },
];

export default function VoiceDetailPanel({
  voiceIndex,
  analysisItem,
  characterName,
  presetNames,
  availableFiles,
  basePresetName,
  onOverrideChange,
}: Props) {
  const [overridePreset, setOverridePreset] = useState<string>("");
  const [partOverrides, setPartOverrides] = useState<Record<string, string>>({});
  const [partsOpen, setPartsOpen] = useState(false);
  const [holdPrevious, setHoldPrevious] = useState(false);
  const [saving, setSaving] = useState(false);

  const sortedPresets = [...presetNames].sort((a, b) =>
    a.localeCompare(b, "ja", { numeric: true })
  );

  // When voice selection changes, load any existing override for that voice
  // so the UI shows the previously-saved values.
  useEffect(() => {
    let cancelled = false;
    setOverridePreset("");
    setPartOverrides({});
    setPartsOpen(false);
    setHoldPrevious(false);
    api
      .getOverrides()
      .then((r) => {
        if (cancelled) return;
        const o = r.overrides[String(voiceIndex)] || r.overrides[voiceIndex as unknown as string];
        if (o) {
          if (o.hold_previous) setHoldPrevious(true);
          if (o.preset_name) setOverridePreset(o.preset_name);
          if (o.part_overrides) {
            setPartOverrides(o.part_overrides);
            // Auto-open the parts section if any part is overridden
            if (Object.values(o.part_overrides).some((v) => v)) setPartsOpen(true);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [voiceIndex]);

  const effectivePreset = overridePreset || analysisItem.resolution?.preset_name || "";
  const hasAnyPartOverride = Object.values(partOverrides).some((v) => v);
  const canApply = !!overridePreset || hasAnyPartOverride;

  async function handleOverride() {
    if (!canApply) return;
    setSaving(true);
    try {
      // If user only changed parts (no preset selected), use the currently
      // resolved preset so the override is well-defined.
      const presetToUse = overridePreset || analysisItem.resolution?.preset_name || "";
      // Drop empty entries from the payload
      const cleanedParts: Record<string, string> = {};
      Object.entries(partOverrides).forEach(([k, v]) => {
        if (v) cleanedParts[k] = v;
      });
      await api.setOverride(voiceIndex, {
        preset_name: presetToUse,
        part_overrides: Object.keys(cleanedParts).length ? cleanedParts : undefined,
        locked: true,
      });
      onOverrideChange?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleResetOverride() {
    setSaving(true);
    try {
      await api.deleteOverride(voiceIndex);
      setOverridePreset("");
      setPartOverrides({});
      setPartsOpen(false);
      onOverrideChange?.();
    } finally {
      setSaving(false);
    }
  }

  async function selectMode(hold: boolean) {
    if (hold === holdPrevious) return;
    setSaving(true);
    try {
      if (hold) {
        // 前回の表情を保つ: drop any per-line expression and flag this voice so
        // the previous line's face item is extended over it on execute.
        await api.setOverride(voiceIndex, { hold_previous: true });
        setHoldPrevious(true);
        setOverridePreset("");
        setPartOverrides({});
        setPartsOpen(false);
      } else {
        // 表情を指定: clear the hold flag (back to automatic resolution).
        await api.deleteOverride(voiceIndex);
        setHoldPrevious(false);
      }
      onOverrideChange?.();
    } finally {
      setSaving(false);
    }
  }

  function setPart(field: string, value: string) {
    setPartOverrides((prev) => {
      const next = { ...prev };
      if (value) next[field] = value;
      else delete next[field];
      return next;
    });
  }

  const emotions = Object.entries(analysisItem.emotion)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="animate-fadeIn">
      <div className="panel-inner p-4 mb-4" style={{ borderRadius: "8px" }}>
        <p style={{ fontSize: "0.875rem", color: "var(--text-primary)", marginBottom: "10px", lineHeight: "1.6" }}>
          {analysisItem.serif}
        </p>

        {analysisItem.raw_emotion ? (
          <div className="space-y-3">
            <div>
              <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>補正後</span>
              <div className="flex flex-wrap gap-1.5">
                {emotions.map(([emotion, score]) => (
                  <span key={emotion} style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    {EMOTION_LABELS[emotion] || emotion}:
                    <span className="mono-text" style={{ marginLeft: "2px" }}>{(score * 100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>生スコア</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(analysisItem.raw_emotion)
                  .filter(([, s]) => s > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([emotion, score]) => (
                    <span key={emotion} style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}>
                      {EMOTION_LABELS[emotion] || emotion}:
                      <span className="mono-text" style={{ marginLeft: "2px" }}>{(score * 100).toFixed(0)}%</span>
                    </span>
                  ))}
              </div>
            </div>
            {analysisItem.gradient && (
              <div>
                <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                  感情変化
                  {analysisItem.gradient.type === "sudden" && (
                    <span className="badge badge-sudden" style={{ marginLeft: "6px" }}>急変</span>
                  )}
                  {analysisItem.gradient.type === "gradual" && (
                    <span className="badge badge-gradual" style={{ marginLeft: "6px" }}>徐々</span>
                  )}
                  {!analysisItem.gradient.type && (
                    <span style={{ marginLeft: "6px", color: "var(--text-faint)", fontSize: "0.7rem" }}>なし</span>
                  )}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(analysisItem.gradient.values)
                    .filter(([, v]) => Math.abs(v) >= 0.05)
                    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                    .map(([emotion, val]) => (
                      <span
                        key={emotion}
                        style={{ fontSize: "0.75rem", color: val > 0 ? "var(--em-happiness)" : "var(--em-anger)" }}
                      >
                        {EMOTION_LABELS[emotion] || emotion}:
                        <span className="mono-text" style={{ marginLeft: "2px" }}>
                          {val > 0 ? "+" : ""}{(val * 100).toFixed(0)}%
                        </span>
                      </span>
                    ))}
                </div>
              </div>
            )}
            {analysisItem.decay && (
              <div>
                <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>残留効果</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(analysisItem.decay.residual)
                    .filter(([, v]) => v >= 0.01)
                    .sort(([, a], [, b]) => b - a)
                    .map(([emotion, val]) => (
                      <span key={emotion} style={{ fontSize: "0.75rem", color: "var(--em-joy)" }}>
                        {EMOTION_LABELS[emotion] || emotion}:
                        <span className="mono-text" style={{ marginLeft: "2px" }}>+{(val * 100).toFixed(0)}%</span>
                      </span>
                    ))}
                  {Object.entries(analysisItem.decay.residual).every(([, v]) => v < 0.01) && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}>なし</span>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {emotions.map(([emotion, score]) => (
              <span key={emotion} style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {EMOTION_LABELS[emotion] || emotion}:
                <span className="mono-text" style={{ marginLeft: "2px" }}>{(score * 100).toFixed(0)}%</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {/* 表情指定 / 前回の表情を保つ の切替 */}
        <div className="flex gap-1" style={{ background: "var(--bg-surface)", borderRadius: "8px", padding: "3px" }}>
          {[
            { hold: false, label: "表情を指定" },
            { hold: true, label: "前回の表情を保つ" },
          ].map((opt) => {
            const active = opt.hold === holdPrevious;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => selectMode(opt.hold)}
                disabled={saving}
                style={{
                  flex: 1,
                  fontSize: "0.78rem",
                  fontWeight: active ? 700 : 500,
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: 0,
                  cursor: saving ? "default" : "pointer",
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "#fff" : "var(--text-muted)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {holdPrevious ? (
          <p
            className="animate-fadeIn"
            style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.7, padding: "4px 2px" }}
          >
            この台詞では新しい表情アイテムを作らず、<strong style={{ color: "var(--text-secondary)" }}>前の台詞の表情</strong>をこの台詞の終端フレームまで継続します。
            （先頭の台詞など直前の表情が無い場合は、その台詞自身の表情を配置します。）
          </p>
        ) : (
        <>
        <div className="flex items-center gap-2">
          <span className="label-text flex-shrink-0" style={{ width: "64px" }}>プリセット</span>
          <select
            value={overridePreset}
            onChange={(e) => setOverridePreset(e.target.value)}
            className="select-field flex-1"
          >
            <option value="">-- 自動（変更なし） --</option>
            {sortedPresets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {effectivePreset && (
            <PresetHoverButton
              characterName={characterName}
              presetName={effectivePreset}
              basePresetName={basePresetName}
            />
          )}
        </div>

        {/* Per-part overrides — collapsible section under the preset row */}
        <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: "10px" }}>
          <button
            type="button"
            onClick={() => setPartsOpen((o) => !o)}
            className="flex items-center justify-between w-full"
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
              marginBottom: partsOpen ? "10px" : 0,
            }}
          >
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)" }}>
              パーツ個別変更
              <span className="label-hint">
                {hasAnyPartOverride
                  ? `${Object.values(partOverrides).filter(Boolean).length} 件設定中`
                  : "プリセットの一部だけ差し替える場合に使用"}
              </span>
            </span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>
              {partsOpen ? "▲ 閉じる" : "▼ 開く"}
            </span>
          </button>
          {partsOpen && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 animate-fadeIn">
              {PART_FIELDS.map(({ key, label }) => {
                const files = availableFiles?.[key] || [];
                const value = partOverrides[key] || "";
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span
                      className="flex-shrink-0"
                      style={{
                        width: "32px",
                        fontSize: "0.72rem",
                        color: value ? "var(--accent)" : "var(--text-muted)",
                        fontWeight: value ? 700 : 500,
                      }}
                    >
                      {label}
                    </span>
                    <select
                      value={value}
                      onChange={(e) => setPart(key, e.target.value)}
                      className="select-field flex-1"
                      style={{ fontSize: "0.72rem" }}
                      disabled={files.length === 0}
                    >
                      <option value="">-- 変更なし --</option>
                      {files.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 合成プレビュー — プリセット＋パーツ個別変更を反映して常時表示 */}
        {effectivePreset && (
          <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: "12px" }}>
            <PresetPreview
              characterName={characterName}
              presetName={effectivePreset}
              basePresetName={basePresetName}
              overrideParts={partOverrides}
              zoomable
            />
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleOverride}
            disabled={!canApply || saving}
            className="btn-primary"
            style={{ fontSize: "0.8rem", padding: "6px 14px" }}
          >
            上書き適用
          </button>
          <button
            onClick={handleResetOverride}
            disabled={saving}
            className="btn-secondary"
            style={{ fontSize: "0.8rem", padding: "5px 14px" }}
          >
            自動に戻す
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
