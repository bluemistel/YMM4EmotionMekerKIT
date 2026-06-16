"use client";
// SPDX-License-Identifier: AGPL-3.0-or-later

import PresetHoverButton from "./PresetHoverButton";
import { useOverrideEditor, EMOTION_LABELS, EMOTION_KEYS, RANK_MARK } from "./OverrideEditorContext";

/** カラム2「個別設定」タブ: 表情の指定操作（感情で指定 / プリセットで指定 /
 *  前回の表情を保つ）。プレビュー・パーツはカラム1（PreviewPartsPanel）。
 *  状態は OverrideEditorContext を共有。 */
export default function VoiceDetailPanel() {
  const {
    analysisItem,
    characterName,
    sortedPresets,
    basePresetName,
    specMode,
    setSpecMode,
    overridePreset,
    emotionOrder,
    emotionTier,
    holdPrevious,
    holdTurns,
    updateHoldTurns,
    scoresOpen,
    setScoresOpen,
    saving,
    effectivePreset,
    tachieType,
    setOverridePreset,
    toggleEmotion,
    setEmotionTier,
    selectMode,
    resetOverride,
  } = useOverrideEditor();

  if (!analysisItem) return null;

  const emotions = Object.entries(analysisItem.emotion)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a);

  function SegBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
      <button
        type="button"
        onClick={onClick}
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
        {label}
      </button>
    );
  }

  return (
    <div className="animate-fadeIn">
      {/* 台詞 + 折り畳み式の感情スコア */}
      <div className="panel-inner p-4 mb-4" style={{ borderRadius: "8px" }}>
        <p style={{ fontSize: "0.875rem", color: "var(--text-primary)", marginBottom: "8px", lineHeight: "1.6" }}>
          {analysisItem.serif}
        </p>
        <button
          type="button"
          onClick={() => setScoresOpen(!scoresOpen)}
          className="btn-ghost"
          style={{ fontSize: "0.72rem", color: "var(--text-faint)", padding: 0 }}
        >
          {scoresOpen ? "▲ 感情スコアを隠す" : "▼ 感情スコアを表示"}
        </button>

        {scoresOpen && (
          <div className="animate-fadeIn mt-2">
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
                      {analysisItem.gradient.type === "sudden" && <span className="badge badge-sudden" style={{ marginLeft: "6px" }}>急変</span>}
                      {analysisItem.gradient.type === "gradual" && <span className="badge badge-gradual" style={{ marginLeft: "6px" }}>徐々</span>}
                      {!analysisItem.gradient.type && <span style={{ marginLeft: "6px", color: "var(--text-faint)", fontSize: "0.7rem" }}>なし</span>}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(analysisItem.gradient.values)
                        .filter(([, v]) => Math.abs(v) >= 0.05)
                        .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                        .map(([emotion, val]) => (
                          <span key={emotion} style={{ fontSize: "0.75rem", color: val > 0 ? "var(--em-happiness)" : "var(--em-anger)" }}>
                            {EMOTION_LABELS[emotion] || emotion}:
                            <span className="mono-text" style={{ marginLeft: "2px" }}>{val > 0 ? "+" : ""}{(val * 100).toFixed(0)}%</span>
                          </span>
                        ))}
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
        )}
      </div>

      <div className="space-y-3">
        {/* 表情指定 / 前回の表情を保つ */}
        <div className="flex gap-1" style={{ background: "var(--bg-surface)", borderRadius: "8px", padding: "3px" }}>
          <SegBtn active={!holdPrevious} label="表情を指定" onClick={() => selectMode(false)} />
          <SegBtn active={holdPrevious} label="前回の表情を保つ" onClick={() => selectMode(true)} />
        </div>

        {holdPrevious ? (
          <div className="animate-fadeIn space-y-2">
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.7, padding: "4px 2px" }}>
              この台詞では新しい表情アイテムを作らず、<strong style={{ color: "var(--text-secondary)" }}>前の台詞の表情</strong>を継続します。
              （先頭の台詞など直前の表情が無い場合は、その台詞自身の表情を配置します。）
            </p>
            <div className="flex items-center gap-2" style={{ padding: "0 2px" }}>
              <span className="label-text" style={{ flex: 1 }}>
                持続ターン数
                <span className="label-hint">0=次の自分の台詞まで（従来）／1以上=後続の別キャラ台詞N本で終了</span>
              </span>
              <input
                type="number"
                min={0}
                max={999}
                value={holdTurns}
                onChange={(e) => updateHoldTurns(Math.max(0, parseInt(e.target.value) || 0))}
                className="input-sm"
                style={{ width: "56px" }}
              />
            </div>
          </div>
        ) : (
          <>
            {/* 感情で指定 / プリセットで指定 */}
            <div className="flex gap-1" style={{ background: "var(--bg-surface)", borderRadius: "8px", padding: "3px" }}>
              <SegBtn active={specMode === "emotion"} label="感情で指定" onClick={() => setSpecMode("emotion")} />
              <SegBtn active={specMode === "preset"} label="プリセットで指定" onClick={() => setSpecMode("preset")} />
            </div>

            {specMode === "emotion" ? (
              <div>
                <span className="label-text" style={{ display: "block", marginBottom: "6px" }}>
                  感情を選択（クリック順に最大3つ・複合）
                  <span className="label-hint">感情マッピングで表情を解決します</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {EMOTION_KEYS.map((key) => {
                    const rank = emotionOrder.indexOf(key);
                    const on = rank >= 0;
                    return (
                      <button
                        key={key}
                        onClick={() => toggleEmotion(key)}
                        style={{
                          fontSize: "0.78rem",
                          fontWeight: on ? 700 : 500,
                          padding: "4px 10px",
                          borderRadius: "6px",
                          border: on ? "1px solid var(--accent)" : "1px solid var(--border-dim)",
                          background: on ? "var(--accent)" : "transparent",
                          color: on ? "#fff" : "var(--text-muted)",
                          cursor: "pointer",
                        }}
                      >
                        {on && <span style={{ marginRight: "3px" }}>{RANK_MARK[rank]}</span>}
                        {EMOTION_LABELS[key]}
                      </button>
                    );
                  })}
                </div>
                {emotionOrder.length === 1 && (
                  <div className="mt-3">
                    <span className="label-text" style={{ display: "block", marginBottom: "6px" }}>
                      強度
                      <span className="label-hint">弱／中／強（弱・強は強度別プリセット、未設定は中へ）</span>
                    </span>
                    <div className="flex gap-1" style={{ background: "var(--bg-surface)", borderRadius: "8px", padding: "3px", maxWidth: "260px" }}>
                      <SegBtn active={emotionTier === "weak"} label="弱" onClick={() => setEmotionTier("weak")} />
                      <SegBtn active={emotionTier === "mid"} label="中" onClick={() => setEmotionTier("mid")} />
                      <SegBtn active={emotionTier === "strong"} label="強" onClick={() => setEmotionTier("strong")} />
                    </div>
                  </div>
                )}
                {emotionOrder.length === 0 && (
                  <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginTop: "6px" }}>
                    未選択の場合は自動判定のままです。
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="label-text flex-shrink-0" style={{ width: "64px" }}>プリセット</span>
                <select value={overridePreset} onChange={(e) => setOverridePreset(e.target.value)} className="select-field flex-1">
                  <option value="">-- 自動（変更なし） --</option>
                  {sortedPresets.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {effectivePreset && (
                  <PresetHoverButton characterName={characterName} presetName={effectivePreset} basePresetName={basePresetName} psd={tachieType === "psd"} />
                )}
              </div>
            )}

            <div className="flex gap-2 items-center">
              <button onClick={resetOverride} disabled={saving} className="btn-secondary" style={{ fontSize: "0.8rem", padding: "5px 14px" }}>
                自動に戻す
              </button>
              <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>変更は自動保存されます</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
