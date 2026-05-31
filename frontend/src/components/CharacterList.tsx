"use client";

import { useState } from "react";
import { api, ProjectInfo } from "@/lib/api";

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
  project: ProjectInfo;
  configs: Record<string, CharacterConfig>;
  onConfigsChange: (configs: Record<string, CharacterConfig>) => void;
  onSelectCharacter: (name: string) => void;
  selectedCharacter: string | null;
  autoHighlightedCharacter?: string | null;
  onSettingsLoaded?: (settings: Record<string, unknown>) => void;
  onRedetect?: () => Promise<void>;
}

export default function CharacterList({
  project,
  configs,
  onConfigsChange,
  onSelectCharacter,
  selectedCharacter,
  autoHighlightedCharacter,
  onSettingsLoaded,
  onRedetect,
}: Props) {
  const [loading, setLoading] = useState(false);

  async function handleRedetect() {
    if (!onRedetect) return handleAutoDetect();
    setLoading(true);
    try {
      await onRedetect();
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoDetect() {
    setLoading(true);
    try {
      const template = await api.generateTemplate();
      const newConfigs: Record<string, CharacterConfig> = {};
      for (const [name, raw] of Object.entries(template.characters)) {
        const c = raw as Record<string, unknown>;
        const presetIni = c.preset_ini as string;
        const tachieDir = c.tachie_dir as string;

        let presetNames: string[] = [];
        let availableFiles: Record<string, string[]> = {};
        if (presetIni) {
          try {
            const res = await api.loadPreset(name, presetIni, tachieDir);
            presetNames = res.preset_names;
            availableFiles = res.available_files || {};
          } catch {
            // preset.ini not found
          }
        }

        newConfigs[name] = {
          preset_ini: presetIni || "",
          tachie_dir: tachieDir || "",
          layer_offset: (c.layer_offset as number) ?? 1,
          emotion_presets: (c.emotion_presets as Record<string, string>) || {},
          compound_presets_2: (c.compound_presets_2 as Record<string, string>) || {},
          compound_presets_3: (c.compound_presets_3 as Record<string, string>) || {},
          compound_max_score: (c.compound_max_score as number) ?? 0.65,
          emotion_parts: (c.emotion_parts as Record<string, Record<string, string>>) || {},
          gradient_presets: (c.gradient_presets as Record<string, string>) || {},
          preset_names: presetNames,
          available_files: availableFiles,
        };
      }
      onConfigsChange(newConfigs);
      if (template.settings) {
        onSettingsLoaded?.(template.settings as Record<string, unknown>);
      }
    } finally {
      setLoading(false);
    }
  }

  const voiceChars = project.characters.filter((c) =>
    project.characters.some((ch) => ch.name === c.name)
  );

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--accent)", fontSize: "0.68rem" }}>&#9670;</span>
          <h2 className="section-title">キャラクター設定</h2>
        </div>
        <button onClick={handleRedetect} disabled={loading} className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 14px" }}>
          {loading ? "検出中..." : "再検出"}
        </button>
      </div>

      <div className="space-y-1.5">
        {voiceChars.map((c) => {
          const cfg = configs[c.name];
          const hasPresets = cfg?.preset_names && cfg.preset_names.length > 0;
          const isSelected = selectedCharacter === c.name;
          const isAuto = !isSelected && autoHighlightedCharacter === c.name;

          return (
            <button
              key={c.name}
              onClick={() => onSelectCharacter(c.name)}
              className="w-full text-left flex items-center justify-between transition-all duration-150"
              style={{
                padding: "9px 14px",
                borderRadius: "8px",
                fontSize: "0.86rem",
                background: isSelected ? "var(--accent-soft)" : "var(--bg-surface)",
                border: isSelected
                  ? "1px solid var(--accent)"
                  : isAuto
                    ? "1px dashed var(--accent)"
                    : "1px solid var(--border-dim)",
                color: "var(--text-primary)",
                boxShadow: isSelected ? "0 0 0 1px var(--accent-ring) inset" : "none",
              }}
            >
              <span className="truncate">{c.name}</span>
              <span className="flex items-center gap-2" style={{ fontSize: "0.7rem" }}>
                {isAuto && <span style={{ color: "var(--accent)" }}>選択中の台詞</span>}
                {hasPresets && (
                  <span style={{ color: "var(--em-happiness)", fontWeight: 700 }}>
                    {cfg.preset_names!.length} presets
                  </span>
                )}
                {c.tachie_directory ? (
                  <span style={{ color: "var(--text-muted)" }}>立ち絵あり</span>
                ) : (
                  <span style={{ color: "var(--em-joy)" }}>立ち絵なし</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
