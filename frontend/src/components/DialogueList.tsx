"use client";

import { useState } from "react";
import { AnalysisItem } from "@/lib/api";
import { frameToTime } from "@/lib/utils";

const EMOTION_BADGE_CLASS: Record<string, string> = {
  joy: "badge-joy",
  anger: "badge-anger",
  sadness: "badge-sadness",
  happiness: "badge-happiness",
  surprise: "badge-surprise",
  embarrassment: "badge-embarrassment",
};

const EMOTION_LABELS: Record<string, string> = {
  joy: "喜",
  anger: "怒",
  sadness: "哀",
  happiness: "楽",
  surprise: "驚",
  embarrassment: "照",
};

const GROUP_COLORS = [
  "var(--em-sadness)",
  "var(--em-happiness)",
  "var(--em-joy)",
  "var(--em-surprise)",
  "var(--em-embarrassment)",
  "var(--cyan)",
  "var(--gradient-sudden)",
  "var(--em-anger)",
];

interface Props {
  analysisResults: Record<string, AnalysisItem> | null;
  fps: number;
  onSelectVoice?: (voiceIndex: number) => void;
  onReanalyze?: () => void;
  analyzing?: boolean;
  selectedVoiceIndex?: number | null;
}

export default function DialogueList({
  analysisResults,
  fps,
  onSelectVoice,
  onReanalyze,
  analyzing,
  selectedVoiceIndex,
}: Props) {
  const [filter, setFilter] = useState("");

  const items = analysisResults
    ? Object.entries(analysisResults)
        .map(([idx, item]) => ({ ...item, voiceIndex: parseInt(idx) }))
        .sort((a, b) => a.frame - b.frame)
    : [];

  const filtered = filter
    ? items.filter(
        (item) =>
          item.serif.includes(filter) || item.character_name.includes(filter)
      )
    : items;

  let lastGroupId: number | null | undefined = undefined;

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--accent)", fontSize: "0.68rem" }}>&#9670;</span>
          <h2 className="section-title">感情分析結果</h2>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>
              {items.length} 件 (表示 {filtered.length})
            </span>
          )}
          {analyzing && (
            <span
              className="flex items-center gap-1.5"
              style={{ fontSize: "0.72rem", color: "var(--accent)", fontWeight: 600 }}
            >
              <span className="spinner" />
              分析中...
            </span>
          )}
          {onReanalyze && (
            <button
              onClick={onReanalyze}
              disabled={analyzing}
              className="btn-secondary"
              style={{ fontSize: "0.76rem", padding: "5px 14px" }}
            >
              再分析
            </button>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="台詞・キャラ名で検索..."
          className="input-field w-full mb-3"
          style={{ fontSize: "0.8125rem" }}
        />
      )}

      <div className="space-y-0 overflow-y-auto" style={{ maxHeight: "300px" }}>
        {filtered.map((item) => {
          const showGroupDivider =
            item.group_id !== undefined &&
            item.group_id !== null &&
            lastGroupId !== undefined &&
            item.group_id !== lastGroupId;
          lastGroupId = item.group_id;

          const groupColor =
            item.group_id !== undefined && item.group_id !== null
              ? GROUP_COLORS[item.group_id % GROUP_COLORS.length]
              : "transparent";

          const isSelected = selectedVoiceIndex === item.voiceIndex;

          return (
            <div key={item.voiceIndex}>
              {showGroupDivider && <div className="group-divider" />}
              <div
                onClick={() => onSelectVoice?.(item.voiceIndex)}
                className="flex items-center gap-3 cursor-pointer transition-all duration-100"
                style={{
                  padding: "7px 11px",
                  borderRadius: "7px",
                  fontSize: "0.85rem",
                  borderLeft: `3px solid ${groupColor}`,
                  background: isSelected ? "var(--accent-soft)" : "transparent",
                  boxShadow: isSelected ? "inset 0 0 0 1px var(--accent-ring)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <span className="mono-text flex-shrink-0 text-right" style={{ width: "64px", fontSize: "0.68rem", color: "var(--text-faint)" }}>
                  {frameToTime(item.frame, fps)}
                </span>
                <span className="flex-shrink-0 truncate" style={{ width: "60px", fontSize: "0.8rem", color: "var(--accent)", fontWeight: 600 }}>
                  {item.character_name.split("_")[0]}
                </span>
                <span
                  className="flex-1 truncate"
                  style={{ color: "var(--text-primary)", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={item.serif}
                >
                  {item.serif}
                </span>
                <div className="flex gap-1 flex-shrink-0 items-center">
                  {Object.entries(item.emotion)
                    .filter(([, score]) => score >= 0.3)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3)
                    .map(([emotion, score]) => (
                      <span
                        key={emotion}
                        className={`badge ${EMOTION_BADGE_CLASS[emotion] || "badge-default"}`}
                        title={`${emotion}: ${(score * 100).toFixed(0)}%`}
                      >
                        {EMOTION_LABELS[emotion] || emotion}
                        <span style={{ opacity: 0.75, marginLeft: "3px", fontFamily: "var(--font-mono)", fontSize: "0.58rem" }}>
                          {(score * 100).toFixed(0)}
                        </span>
                      </span>
                    ))}
                  {Object.entries(item.emotion).every(([, s]) => s < 0.3) && (
                    <span className="badge badge-default">通常</span>
                  )}
                  {item.gradient?.type === "sudden" && (
                    <span className="badge badge-sudden" title="急激な感情変化">急変</span>
                  )}
                  {item.gradient?.type === "gradual" && (
                    <span className="badge badge-gradual" title="徐々に変化">徐々</span>
                  )}
                  {item.resolution?.source === "override" && (
                    <span
                      className="badge"
                      style={{ background: "#d2683a16", color: "var(--gradient-sudden)", border: "1px solid #d2683a40" }}
                      title={`個別設定: ${item.resolution.preset_name}`}
                    >
                      個別
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="text-center" style={{ padding: "32px 0", color: "var(--text-faint)", fontSize: "0.85rem" }}>
            プロジェクトを読み込むと感情分析が自動実行されます
          </div>
        )}
      </div>
    </div>
  );
}
