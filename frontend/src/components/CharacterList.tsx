"use client";

import { useState } from "react";
import { api, ProjectInfo } from "@/lib/api";

interface CharacterConfig {
  preset_ini: string;
  tachie_dir: string;
  layer_offset: number;
  emotion_presets: Record<string, string>;
  emotion_intensity_presets: Record<string, Record<string, string>>;
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
          emotion_intensity_presets: (c.emotion_intensity_presets as Record<string, Record<string, string>>) || {},
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

      {/* 色＋頭文字アイコンの横並び（多人数でも縦を圧迫しない）。hover で正式名。 */}
      <div className="flex flex-wrap gap-2">
        {voiceChars.map((c) => {
          const cfg = configs[c.name];
          const presetCount = cfg?.preset_names?.length || 0;
          const isSelected = selectedCharacter === c.name;
          const isAuto = !isSelected && autoHighlightedCharacter === c.name;
          const initial = (c.name.trim()[0] || "?");
          const bg = c.color || "var(--text-faint)";
          // PSD立ち絵はディレクトリではなく psd_path を持つため、両方を見て判定する。
          const hasTachie = !!(c.tachie_directory || (c.tachie_type === "psd" && c.psd_path));
          const tachie = hasTachie ? "立ち絵あり" : "立ち絵なし";
          const title = `${c.name}｜${presetCount} presets｜${tachie}`;

          return (
            <button
              key={c.name}
              onClick={() => onSelectCharacter(c.name)}
              title={title}
              className="flex items-center justify-center transition-all duration-150"
              style={{
                position: "relative",
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                flexShrink: 0,
                background: bg,
                color: "#fff",
                fontWeight: 700,
                fontSize: "1.0rem",
                textShadow: "0 1px 2px #00000066",
                cursor: "pointer",
                border: isSelected
                  ? "2px solid var(--accent)"
                  : isAuto
                    ? "2px dashed var(--accent)"
                    : "2px solid transparent",
                boxShadow: isSelected ? "0 0 0 2px var(--accent-ring)" : "0 1px 3px #0000001f",
                opacity: hasTachie ? 1 : 0.5,
              }}
            >
              {initial}
              {presetCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    bottom: "-2px",
                    right: "-2px",
                    width: "9px",
                    height: "9px",
                    borderRadius: "50%",
                    background: "var(--em-happiness)",
                    border: "1.5px solid var(--bg-panel)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
