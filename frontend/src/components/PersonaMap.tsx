"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

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
  persona_valence?: number;
  persona_arousal?: number;
  persona_strength?: number;
  preset_names?: string[];
  available_files?: Record<string, string[]>;
}

interface Props {
  characters: string[];
  configs: Record<string, CharacterConfig>;
  onConfigChange: (name: string, config: CharacterConfig) => void;
  /** 外部選択（CharacterList/台詞）と同期して強度スライダー対象を初期化する。
   *  マップ上の操作はこの値を変更しない（感情マッピング領域を勝手に開かないため）。 */
  selectedCharacter?: string | null;
  /** キャラ名→色（キャラクター設定のアイコン色と統一）。 */
  colors?: Record<string, string | null>;
}

// 感情アンカー（valence, arousal は -1..1。マップ座標は 0..1 に変換して描画）。
const EMOTION_ANCHORS: { key: string; label: string; v: number; a: number }[] = [
  { key: "joy", label: "喜", v: 0.8, a: 0.5 },
  { key: "happiness", label: "楽", v: 0.6, a: 0.1 },
  { key: "anger", label: "怒", v: -0.7, a: 0.8 },
  { key: "sadness", label: "哀", v: -0.7, a: -0.5 },
  { key: "fear", label: "恐", v: -0.6, a: 0.7 },
  { key: "disgust", label: "嫌", v: -0.6, a: 0.1 },
  { key: "surprise", label: "驚", v: 0.0, a: 0.9 },
  { key: "embarrassment", label: "照", v: 0.3, a: 0.2 },
  { key: "exasperation", label: "呆", v: -0.4, a: -0.2 },
];

/** キャラの性格マップ（#4）。感情価×覚醒度にキャラを配置し、
 *  感情スコアへのソフトな事前分布として反映する。 */
export default function PersonaMap({
  characters,
  configs,
  onConfigChange,
  selectedCharacter,
  colors,
}: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [dragName, setDragName] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  // マップ内のアクティブキャラ（強度スライダー対象）。グローバル選択とは独立に持ち、
  // マップ操作で感情マッピング領域を開かない（レイアウト移動でアイコンがズレる問題の回避）。
  const [activeName, setActiveName] = useState<string | null>(null);

  // 外部選択（CharacterList/台詞）が変わったらマップ側の対象も追従（マップ→外部の一方向は無し）。
  useEffect(() => {
    if (selectedCharacter && configs[selectedCharacter]) setActiveName(selectedCharacter);
  }, [selectedCharacter, configs]);

  const active = activeName && configs[activeName] ? activeName : null;

  function persist(name: string, cfg: CharacterConfig) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.updateCharacterConfig(name, {
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
        persona_valence: cfg.persona_valence ?? 0,
        persona_arousal: cfg.persona_arousal ?? 0,
        persona_strength: cfg.persona_strength ?? 0,
      }).catch(() => {});
    }, 400);
  }

  function setPosition(name: string, vx: number, vy: number) {
    const base = configs[name];
    if (!base) return;
    const cfg = { ...base, persona_valence: vx, persona_arousal: vy };
    // 位置を動かしたら strength 未設定(0)なら既定 0.5 で有効化。
    if (!cfg.persona_strength || cfg.persona_strength <= 0) cfg.persona_strength = 0.5;
    onConfigChange(name, cfg);
    persist(name, cfg);
  }

  function setStrength(name: string, s: number) {
    const base = configs[name];
    if (!base) return;
    const cfg = { ...base, persona_strength: s };
    onConfigChange(name, cfg);
    persist(name, cfg);
  }

  function pointerToValAr(clientX: number, clientY: number): [number, number] {
    const el = areaRef.current;
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const py = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    // x: 0..1 -> valence -1..1 / y: 上が高覚醒(+1)
    return [px * 2 - 1, (1 - py) * 2 - 1];
  }

  function onPointerDown(name: string, e: React.PointerEvent) {
    e.preventDefault();
    setActiveName(name);  // マップ内のみ。グローバル選択は変更しない。
    setDragName(name);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragName) return;
    const [v, a] = pointerToValAr(e.clientX, e.clientY);
    setPosition(dragName, Math.round(v * 100) / 100, Math.round(a * 100) / 100);
  }

  function onPointerUp() {
    setDragName(null);
  }

  const toXY = (v: number, a: number) => ({
    left: `${((v + 1) / 2) * 100}%`,
    top: `${(1 - (a + 1) / 2) * 100}%`,
  });

  return (
    <div className="panel p-4" style={{ position: "relative" }}>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: "var(--accent)", fontSize: "0.68rem" }}>&#9670;</span>
        <h2 className="section-title">キャラの性格マップ</h2>
      </div>
      <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginBottom: "8px", lineHeight: 1.6 }}>
        キャラを配置すると、その方向の感情が出やすくなります（横=ネガ⇔ポジ / 縦=落ち着き⇔ハイテンション）。分析へのソフトな事前分布として反映されます。
      </p>

      <div style={{ position: "relative" }}>
        <div
          ref={areaRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "1 / 1",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-dim)",
            borderRadius: "8px",
            overflow: "hidden",
            touchAction: "none",
          }}
        >
          {/* 軸線 */}
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "1px", background: "var(--border-dim)" }} />
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: "1px", background: "var(--border-dim)" }} />
          {/* 軸ラベル */}
          <span style={{ position: "absolute", top: "2px", left: "50%", transform: "translateX(-50%)", fontSize: "0.62rem", color: "var(--text-faint)" }}>ハイテンション</span>
          <span style={{ position: "absolute", bottom: "2px", left: "50%", transform: "translateX(-50%)", fontSize: "0.62rem", color: "var(--text-faint)" }}>落ち着き</span>
          <span style={{ position: "absolute", left: "3px", top: "50%", transform: "translateY(-50%)", fontSize: "0.62rem", color: "var(--text-faint)" }}>ネガ</span>
          <span style={{ position: "absolute", right: "3px", top: "50%", transform: "translateY(-50%)", fontSize: "0.62rem", color: "var(--text-faint)" }}>ポジ</span>

          {/* 感情アンカー（薄い） */}
          {EMOTION_ANCHORS.map((em) => (
            <span
              key={em.key}
              style={{ position: "absolute", ...toXY(em.v, em.a), transform: "translate(-50%,-50%)", fontSize: "0.7rem", color: "var(--text-faint)", opacity: 0.5, pointerEvents: "none" }}
            >
              {em.label}
            </span>
          ))}

          {/* キャラトークン */}
          {characters.map((name) => {
            const cfg = configs[name];
            if (!cfg) return null;
            const v = cfg.persona_valence ?? 0;
            const a = cfg.persona_arousal ?? 0;
            const isActive = name === active;
            const on = (cfg.persona_strength ?? 0) > 0;
            return (
              <div
                key={name}
                onPointerDown={(e) => onPointerDown(name, e)}
                title={name}
                style={{
                  position: "absolute",
                  ...toXY(v, a),
                  transform: "translate(-50%,-50%)",
                  width: "26px",
                  height: "26px",
                  borderRadius: "50%",
                  background: colors?.[name] || "var(--text-faint)",
                  border: isActive ? "2px solid var(--accent)" : "2px solid #fff8",
                  boxShadow: "0 1px 4px #0004",
                  color: "#fff",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "grab",
                  opacity: on ? 1 : 0.5,
                  userSelect: "none",
                }}
              >
                {name.slice(0, 1)}
              </div>
            );
          })}
        </div>

        {/* 選択キャラの強度スライダー */}
        {active && (
          <div className="mt-3">
            <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
              「{active}」の強さ: <span className="mono-text">{(configs[active].persona_strength ?? 0).toFixed(2)}</span>
              <span className="label-hint">0=無効。大きいほど性格の方向付けが強く反映</span>
            </span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={configs[active].persona_strength ?? 0}
              onChange={(e) => setStrength(active, parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
