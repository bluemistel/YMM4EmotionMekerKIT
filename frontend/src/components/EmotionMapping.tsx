"use client";
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect, useRef } from "react";
import { api, ResolutionInfo } from "@/lib/api";
import PresetHoverButton from "./PresetHoverButton";

const ALL_EMOTIONS = [
  { key: "joy", label: "喜", cssVar: "--em-joy" },
  { key: "anger", label: "怒", cssVar: "--em-anger" },
  { key: "sadness", label: "哀", cssVar: "--em-sadness" },
  { key: "happiness", label: "楽", cssVar: "--em-happiness" },
  { key: "surprise", label: "驚き", cssVar: "--em-surprise" },
  { key: "embarrassment", label: "照れ", cssVar: "--em-embarrassment" },
  { key: "disgust", label: "嫌悪", cssVar: "--em-disgust" },
  { key: "fear", label: "恐れ", cssVar: "--em-fear" },
  { key: "exasperation", label: "呆れ", cssVar: "--em-exasperation" },
  { key: "default", label: "通常", cssVar: "--text-muted" },
];

interface CharacterConfig {
  preset_ini: string;
  tachie_dir: string;
  tachie_type?: string;
  psd_path?: string;
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
  characterName: string;
  config: CharacterConfig;
  onConfigChange: (config: CharacterConfig) => void;
  resolvedSlot?: ResolutionInfo | null;
  onSwitchToOverride?: () => void;
  onSaved?: () => void;
  postprocessEnabled?: boolean;
  /** 無効化された感情キー（マッピング行・複合組合せから除外する）。 */
  disabledEmotions?: string[];
  /** 複合感情の自動ミラー登録（既定ON）。ONなら複合キーの全順列へ同値を一括適用。 */
  compoundAutoMirror?: boolean;
}

/** 配列の全順列を返す（要素は相異なる前提＝複合キーは重複しない感情）。 */
function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

const HIT_STYLE: React.CSSProperties = {
  background: "var(--accent-soft)",
  borderRadius: "8px",
  boxShadow: "0 0 0 1px var(--accent) inset",
};

/** Preset dropdown + hover preview. Defined at module scope (NOT inside the
 *  parent component) so that re-renders triggered by background auto-save don't
 *  remount the <select> and close an open listbox. */
function PresetSelect({
  value,
  onChange,
  presetNames,
  characterName,
  basePresetName,
  psd = false,
}: {
  value: string;
  onChange: (v: string) => void;
  presetNames: string[];
  characterName: string;
  basePresetName?: string;
  psd?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select-field flex-1"
      >
        <option value="">-- 未設定 --</option>
        {presetNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {value && (
        <PresetHoverButton
          characterName={characterName}
          presetName={value}
          basePresetName={basePresetName}
          psd={psd}
        />
      )}
    </div>
  );
}

export default function EmotionMapping({
  characterName,
  config,
  onConfigChange,
  resolvedSlot,
  onSwitchToOverride,
  onSaved,
  postprocessEnabled = false,
  disabledEmotions = [],
  compoundAutoMirror = true,
}: Props) {
  const [autoSavedMsg, setAutoSavedMsg] = useState("");
  const [expandedEmotions, setExpandedEmotions] = useState<Set<string>>(new Set());
  // 勾配プリセットの開閉は localStorage に永続化（再マウント/再読込でも保持）。
  const [gradientOpen, setGradientOpenState] = useState<boolean>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("ymm4.gradientOpen") === "1";
    return false;
  });
  function setGradientOpen(v: boolean) {
    setGradientOpenState(v);
    try {
      localStorage.setItem("ymm4.gradientOpen", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  const saveTimer = useRef<number | null>(null);

  // 無効ラベルを除いた表示用リスト（複合の組合せ爆発を抑制）。「通常」は常に表示。
  const disabledSet = new Set(disabledEmotions);
  const EMOTIONS = ALL_EMOTIONS.filter((e) => e.key === "default" || !disabledSet.has(e.key));
  const EMOTION_KEYS = EMOTIONS.filter((e) => e.key !== "default").map((e) => e.key);

  // Persist a config to the backend (config.yaml). Used by both the manual
  // 保存 button and the debounced auto-save.
  function persistConfig(cfg: CharacterConfig, charName: string) {
    return api.updateCharacterConfig(charName, {
      preset_ini: cfg.preset_ini,
      tachie_dir: cfg.tachie_dir,
      layer_offset: cfg.layer_offset,
      emotion_presets: cfg.emotion_presets,
      emotion_intensity_presets: cfg.emotion_intensity_presets,
      compound_presets_2: cfg.compound_presets_2,
      compound_presets_3: cfg.compound_presets_3,
      compound_max_score: cfg.compound_max_score,
      emotion_parts: cfg.emotion_parts,
      gradient_presets: cfg.gradient_presets,
    });
  }

  // Auto-save on edit (debounced). Captures the character name + config at
  // call time so a later character switch can't misroute a pending save.
  function scheduleAutoSave(cfg: CharacterConfig, charName: string) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await persistConfig(cfg, charName);
        onSaved?.();
        setAutoSavedMsg("自動保存しました");
        window.setTimeout(() => setAutoSavedMsg(""), 1800);
      } catch {
        // non-fatal; the manual 保存 button remains as a fallback
      }
    }, 600);
  }

  // Apply an edit: update parent state and queue a debounced backend save.
  function commitChange(cfg: CharacterConfig) {
    onConfigChange(cfg);
    scheduleAutoSave(cfg, characterName);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);
  const presetNames = [...(config.preset_names || [])].sort((a, b) =>
    a.localeCompare(b, "ja", { numeric: true })
  );

  const slot = resolvedSlot?.slot_key || "";
  const isOverridden = resolvedSlot?.source === "override";
  let hitBase: string | null = null;
  let hitTier: string | null = null; // "weak" | "strong"（中は base 行）
  let hitC2: string | null = null;
  let hitC3: string | null = null;
  let hitGrad: string | null = null;
  if (slot === "default") hitBase = "default";
  else if (slot.startsWith("emotion:")) {
    // emotion:{emo} | emotion:{emo}:weak | emotion:{emo}:strong
    const rest = slot.slice(8).split(":");
    hitBase = rest[0];
    hitTier = rest[1] || null;
  }
  else if (slot.startsWith("compound2:")) hitC2 = slot.slice(10);
  else if (slot.startsWith("compound3:")) hitC3 = slot.slice(10);
  else if (slot.startsWith("gradient_")) {
    const m = slot.match(/^gradient_(sudden|gradual):(.+)$/);
    if (m) hitGrad = `${m[1]}_${m[2]}`;
  }

  // Auto-expand parents so the resolved compound row is visible (要件6a/risk7).
  // Keyed on slot only — later manual toggles are respected.
  useEffect(() => {
    const toExpand: string[] = [];
    if (hitBase && hitTier) toExpand.push(hitBase); // 強度ヒット時は該当感情を展開
    if (hitC2) toExpand.push(hitC2.split("+")[0]);
    if (hitC3) {
      const [e1, e2] = hitC3.split("+");
      toExpand.push(e1, `${e1}+${e2}`);
    }
    if (toExpand.length) {
      setExpandedEmotions((prev) => {
        const next = new Set(prev);
        toExpand.forEach((k) => next.add(k));
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  function handlePresetChange(emotionKey: string, presetName: string) {
    commitChange({
      ...config,
      emotion_presets: { ...config.emotion_presets, [emotionKey]: presetName },
    });
  }

  // 単独感情の強度別（弱/強）プリセット。中は emotion_presets（行本体）。
  function handleIntensityChange(emotionKey: string, tier: "weak" | "strong", presetName: string) {
    const tiers = { ...(config.emotion_intensity_presets[emotionKey] || {}) };
    if (presetName) tiers[tier] = presetName;
    else delete tiers[tier];
    const map = { ...config.emotion_intensity_presets };
    if (Object.keys(tiers).length) map[emotionKey] = tiers;
    else delete map[emotionKey];
    commitChange({ ...config, emotion_intensity_presets: map });
  }

  // 複合キーの対象順序を返す。自動ミラーONなら全順列、OFFなら当該キーのみ。
  function mirrorKeys(key: string): string[] {
    if (!compoundAutoMirror) return [key];
    return permutations(key.split("+")).map((p) => p.join("+"));
  }

  function handleCompound2Change(key: string, presetName: string) {
    const map = { ...config.compound_presets_2 };
    for (const k of mirrorKeys(key)) {
      if (presetName) map[k] = presetName;
      else delete map[k];
    }
    commitChange({ ...config, compound_presets_2: map });
  }

  function handleCompound3Change(key: string, presetName: string) {
    const map = { ...config.compound_presets_3 };
    for (const k of mirrorKeys(key)) {
      if (presetName) map[k] = presetName;
      else delete map[k];
    }
    commitChange({ ...config, compound_presets_3: map });
  }

  function handleGradientPresetChange(key: string, presetName: string) {
    const updated = {
      ...config,
      gradient_presets: { ...config.gradient_presets, [key]: presetName },
    };
    if (!presetName) delete updated.gradient_presets[key];
    commitChange(updated);
  }

  function toggleExpand(key: string) {
    setExpandedEmotions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const basePresetName = config.emotion_presets.default;
  const isPsd = config.tachie_type === "psd";

  return (
    <div>
      {isOverridden && (
        <div
          className="flex items-center justify-between mb-3 animate-fadeIn"
          style={{
            background: "#d2683a14",
            border: "1px solid #d2683a40",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "0.78rem",
            color: "var(--gradient-sudden)",
          }}
        >
          <span>この台詞は「個別設定」で上書きされています</span>
          {onSwitchToOverride && (
            <button onClick={onSwitchToOverride} className="btn-ghost" style={{ color: "var(--gradient-sudden)" }}>
              個別設定を開く →
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-5">
          <div>
            <span className="label-text">レイヤーオフセット</span>
            <input
              type="number"
              value={config.layer_offset}
              onChange={(e) => commitChange({ ...config, layer_offset: parseInt(e.target.value) || 1 })}
              className="input-sm ml-2"
              style={{ width: "56px" }}
            />
          </div>
          <div>
            <span className="label-text">複合閾値</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={config.compound_max_score}
              onChange={(e) => commitChange({ ...config, compound_max_score: parseFloat(e.target.value) || 0.65 })}
              className="input-sm ml-2"
              style={{ width: "68px" }}
            />
          </div>
        </div>
        <span style={{ fontSize: "0.72rem", color: "var(--text-faint)", whiteSpace: "nowrap" }}>
          {autoSavedMsg || "変更は自動保存されます"}
        </span>
      </div>

      <div className="space-y-1">
        {EMOTIONS.map((em) => {
          const isDefault = em.key === "default";
          const isExpanded = expandedEmotions.has(em.key);
          const otherEmotions = EMOTION_KEYS.filter((k) => k !== em.key);
          const rowHit = hitBase === em.key && !hitTier; // 中（mid）のときだけ行本体を強調
          const tiers = config.emotion_intensity_presets[em.key] || {};

          return (
            <div key={em.key}>
              <div
                className="flex items-center gap-3"
                style={{ padding: "4px 6px", ...(rowHit ? HIT_STYLE : {}) }}
              >
                {!isDefault ? (
                  <button
                    onClick={() => toggleExpand(em.key)}
                    className="btn-ghost flex-shrink-0"
                    style={{ width: "18px", fontSize: "0.65rem", color: "var(--text-faint)" }}
                  >
                    {isExpanded ? "▼" : "▶"}
                  </button>
                ) : (
                  <span style={{ width: "18px" }} className="flex-shrink-0" />
                )}
                <span
                  className="flex-shrink-0"
                  style={{ width: "40px", fontSize: "0.9rem", fontWeight: 700, color: `var(${em.cssVar})` }}
                >
                  {em.label}
                </span>
                <PresetSelect
                  value={config.emotion_presets[em.key] || ""}
                  onChange={(v) => handlePresetChange(em.key, v)}
                  presetNames={presetNames}
                  characterName={characterName}
                  basePresetName={basePresetName}
                  psd={isPsd}
                />
              </div>

              {!isDefault && isExpanded && (
                <div className="animate-fadeIn" style={{ marginLeft: "36px", marginTop: "2px", paddingLeft: "12px", borderLeft: "1px solid var(--border-dim)" }}>
                  {/* 強度別（弱/強）。中はこの感情の行本体（上）。スコアの大小で切替。 */}
                  {(["weak", "strong"] as const).map((tier) => {
                    const tHit = hitBase === em.key && hitTier === tier;
                    return (
                      <div
                        key={tier}
                        className="flex items-center gap-3"
                        style={{ padding: "3px 6px", ...(tHit ? HIT_STYLE : {}) }}
                      >
                        <span style={{ width: "14px" }} className="flex-shrink-0" />
                        <span
                          className="flex-shrink-0"
                          style={{ width: "56px", fontSize: "0.72rem", fontWeight: 600, color: tier === "strong" ? "var(--em-anger)" : "var(--text-faint)" }}
                          title={tier === "weak" ? "弱い強度のとき" : "強い強度のとき"}
                        >
                          {tier === "weak" ? "弱" : "強"}
                        </span>
                        <PresetSelect
                          value={tiers[tier] || ""}
                          onChange={(v) => handleIntensityChange(em.key, tier, v)}
                          presetNames={presetNames}
                          characterName={characterName}
                          basePresetName={basePresetName}
                          psd={isPsd}
                        />
                      </div>
                    );
                  })}
                  {otherEmotions.map((sub) => {
                    const key2 = `${em.key}+${sub}`;
                    const subLabel = EMOTIONS.find((e) => e.key === sub)?.label || sub;
                    const isSubExpanded = expandedEmotions.has(key2);
                    const thirdEmotions = otherEmotions.filter((k) => k !== sub);
                    const c2Hit = hitC2 === key2;

                    return (
                      <div key={key2}>
                        <div
                          className="flex items-center gap-3"
                          style={{ padding: "3px 6px", ...(c2Hit ? HIT_STYLE : {}) }}
                        >
                          <button
                            onClick={() => toggleExpand(key2)}
                            className="btn-ghost flex-shrink-0"
                            style={{ width: "14px", fontSize: "0.6rem", color: "var(--text-faint)" }}
                          >
                            {isSubExpanded ? "▼" : "▶"}
                          </button>
                          <span style={{ width: "56px", fontSize: "0.75rem", color: "var(--text-muted)" }} className="flex-shrink-0">
                            +{subLabel}
                          </span>
                          <PresetSelect
                            value={config.compound_presets_2[key2] || ""}
                            onChange={(v) => handleCompound2Change(key2, v)}
                            presetNames={presetNames}
                            characterName={characterName}
                            basePresetName={basePresetName}
                            psd={isPsd}
                          />
                        </div>

                        {isSubExpanded && (
                          <div className="animate-fadeIn" style={{ marginLeft: "28px", marginTop: "2px", paddingLeft: "12px", borderLeft: "1px solid var(--border-dim)" }}>
                            {thirdEmotions.map((third) => {
                              const key3 = `${em.key}+${sub}+${third}`;
                              const thirdLabel = EMOTIONS.find((e) => e.key === third)?.label || third;
                              const c3Hit = hitC3 === key3;
                              return (
                                <div
                                  key={key3}
                                  className="flex items-center gap-3"
                                  style={{ padding: "3px 6px", ...(c3Hit ? HIT_STYLE : {}) }}
                                >
                                  <span style={{ width: "14px" }} className="flex-shrink-0" />
                                  <span style={{ width: "56px", fontSize: "0.7rem", color: "var(--text-faint)" }} className="flex-shrink-0">
                                    +{thirdLabel}
                                  </span>
                                  <PresetSelect
                                    value={config.compound_presets_3[key3] || ""}
                                    onChange={(v) => handleCompound3Change(key3, v)}
                                    presetNames={presetNames}
                                    characterName={characterName}
                                    basePresetName={basePresetName}
                                    psd={isPsd}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="divider-glow mt-5 mb-4" />

      <div>
        <button
          type="button"
          onClick={() => postprocessEnabled && setGradientOpen(!gradientOpen)}
          className="flex items-center justify-between w-full"
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: postprocessEnabled ? "pointer" : "default",
            marginBottom: gradientOpen && postprocessEnabled ? "10px" : 0,
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontSize: "0.85rem", fontWeight: 700, color: postprocessEnabled ? "var(--text-secondary)" : "var(--text-faint)" }}>
            勾配プリセット
            <span className="label-hint">
              {postprocessEnabled ? "感情変化による上書き" : "感情後処理を有効にすると使用できます"}
            </span>
          </span>
          {postprocessEnabled && (
            <span style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>
              {gradientOpen ? "▲ 閉じる" : "▼ 開く"}
            </span>
          )}
        </button>
        {postprocessEnabled && gradientOpen && (
        <div className="grid grid-cols-1 gap-y-1.5 animate-fadeIn">
          {(["sudden", "gradual"] as const).map((gType) =>
            EMOTION_KEYS.map((ek) => {
              const key = `${gType}_${ek}`;
              const label = gType === "sudden" ? "急変" : "徐々";
              const emLabel = EMOTIONS.find((e) => e.key === ek)?.label || ek;
              const gHit = hitGrad === key;
              return (
                <div
                  key={key}
                  className="flex items-center gap-2"
                  style={{ padding: "2px 4px", ...(gHit ? HIT_STYLE : {}) }}
                >
                  <span
                    className="flex-shrink-0"
                    style={{
                      width: "60px",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: gType === "sudden" ? "var(--gradient-sudden)" : "var(--gradient-gradual)",
                    }}
                  >
                    {label}:{emLabel}
                  </span>
                  <select
                    value={config.gradient_presets[key] || ""}
                    onChange={(e) => handleGradientPresetChange(key, e.target.value)}
                    className="select-field flex-1"
                    style={{ fontSize: "0.75rem" }}
                  >
                    <option value="">-- 未設定 --</option>
                    {presetNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              );
            })
          )}
        </div>
        )}
      </div>
    </div>
  );
}
