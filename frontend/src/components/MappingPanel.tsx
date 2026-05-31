"use client";

import { AnalysisItem, ResolutionInfo } from "@/lib/api";
import EmotionMapping from "./EmotionMapping";
import VoiceDetailPanel from "./VoiceDetailPanel";

interface CharacterConfig {
  preset_ini: string;
  tachie_dir: string;
  layer_offset: number;
  emotion_presets: Record<string, string>;
  compound_presets_2: Record<string, string>;
  compound_presets_3: Record<string, string>;
  compound_max_score: number;
  emotion_parts: Record<string, Record<string, string>>;
  gradient_presets: Record<string, string>;
  preset_names?: string[];
  available_files?: Record<string, string[]>;
}

interface Props {
  characterName: string;
  config: CharacterConfig;
  onConfigChange: (config: CharacterConfig) => void;
  tab: "mapping" | "override";
  onTabChange: (tab: "mapping" | "override") => void;
  resolvedSlot?: ResolutionInfo | null;
  selectedVoiceIndex: number | null;
  analysisItem: AnalysisItem | null;
  onOverrideChange?: () => void;
  onSaved?: () => void;
  postprocessEnabled?: boolean;
}

export default function MappingPanel({
  characterName,
  config,
  onConfigChange,
  tab,
  onTabChange,
  resolvedSlot,
  selectedVoiceIndex,
  analysisItem,
  onOverrideChange,
  onSaved,
  postprocessEnabled,
}: Props) {
  function SegBtn({ value, label }: { value: "mapping" | "override"; label: string }) {
    const on = tab === value;
    return (
      <button
        onClick={() => onTabChange(value)}
        style={{
          flex: 1,
          padding: "7px",
          border: 0,
          borderRadius: "6px",
          background: on ? "var(--accent)" : "transparent",
          color: on ? "#ffffff" : "var(--text-muted)",
          fontFamily: "var(--font-body)",
          fontSize: "0.82rem",
          fontWeight: on ? 700 : 600,
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--accent)", fontSize: "0.68rem" }}>&#9670;</span>
          <h2 className="section-title">
            {tab === "mapping" ? "感情マッピング" : "個別設定"}
          </h2>
          <span style={{ fontSize: "0.82rem", color: "var(--accent)", fontWeight: 700, marginLeft: "4px" }}>
            {characterName}
          </span>
        </div>
      </div>

      <div
        className="flex gap-1 mb-3"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-dim)",
          borderRadius: "9px",
          padding: "4px",
        }}
      >
        <SegBtn value="mapping" label="感情マッピング" />
        <SegBtn value="override" label="個別設定" />
      </div>

      {tab === "mapping" ? (
        <EmotionMapping
          characterName={characterName}
          config={config}
          onConfigChange={onConfigChange}
          resolvedSlot={resolvedSlot}
          onSwitchToOverride={() => onTabChange("override")}
          onSaved={onSaved}
          postprocessEnabled={postprocessEnabled}
        />
      ) : analysisItem && selectedVoiceIndex !== null ? (
        <VoiceDetailPanel
          voiceIndex={selectedVoiceIndex}
          analysisItem={analysisItem}
          characterName={characterName}
          presetNames={config.preset_names || []}
          availableFiles={config.available_files || {}}
          basePresetName={config.emotion_presets.default}
          onOverrideChange={onOverrideChange}
        />
      ) : (
        <p
          style={{
            fontSize: "0.82rem",
            color: "var(--text-muted)",
            padding: "20px 0",
            textAlign: "center",
          }}
        >
          「感情分析結果」で台詞を選択すると個別設定できます
        </p>
      )}
    </div>
  );
}
