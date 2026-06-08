"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, AnalysisItem } from "@/lib/api";

// 個別設定の「感情で指定」ボタン用。FullHD で1行に収まるよう全て1文字。
export const EMOTION_LABELS: Record<string, string> = {
  joy: "喜",
  anger: "怒",
  sadness: "哀",
  happiness: "楽",
  surprise: "驚",
  embarrassment: "照",
  disgust: "嫌",
  fear: "恐",
  exasperation: "呆",
};
export const EMOTION_KEYS = Object.keys(EMOTION_LABELS);
export const RANK_MARK = ["①", "②", "③"];

// パーツを明示的に「なし」にするセンチネル。バックエンドへは "" で送る（=パーツ消去）。
export const NONE_PART = "__none__";

export const PART_FIELDS: { key: string; label: string }[] = [
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

export type SpecMode = "preset" | "emotion";

export type EmotionTier = "weak" | "mid" | "strong";

interface Snapshot {
  specMode: SpecMode;
  overridePreset: string;
  emotionOrder: string[];
  emotionTier: EmotionTier;
  partOverrides: Record<string, string>;
  psdLayerOverrides: Record<string, boolean>;
}

interface OverrideEditorValue {
  voiceIndex: number | null;
  analysisItem: AnalysisItem | null;
  characterName: string;
  presetNames: string[];
  sortedPresets: string[];
  availableFiles: Record<string, string[]>;
  basePresetName?: string | null;
  // 立ち絵規格（"png" / "psd"）と PSD ファイルパス。
  tachieType: string;
  psdPath: string | null;
  // state
  specMode: SpecMode;
  setSpecMode: (m: SpecMode) => void;
  overridePreset: string;
  emotionOrder: string[];
  emotionTier: EmotionTier;
  partOverrides: Record<string, string>;
  psdLayerOverrides: Record<string, boolean>;
  holdPrevious: boolean;
  scoresOpen: boolean;
  setScoresOpen: (o: boolean) => void;
  saving: boolean;
  effectivePreset: string;
  hasAnyPartOverride: boolean;
  // handlers
  setOverridePreset: (name: string) => void;
  toggleEmotion: (key: string) => void;
  setEmotionTier: (tier: EmotionTier) => void;
  setPart: (field: string, value: string) => void;
  setPsdLayers: (next: Record<string, boolean>) => void;
  selectMode: (hold: boolean) => void;
  resetOverride: () => void;
  /** 保存後に親の configs[char].preset_names を更新する。 */
  onPresetsChanged?: (characterName: string, names: string[]) => void;
}

const Ctx = createContext<OverrideEditorValue | null>(null);

export function useOverrideEditor(): OverrideEditorValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOverrideEditor must be used within OverrideEditorProvider");
  return v;
}

interface ProviderProps {
  voiceIndex: number | null;
  analysisItem: AnalysisItem | null;
  characterName: string;
  presetNames: string[];
  availableFiles?: Record<string, string[]>;
  basePresetName?: string | null;
  tachieType?: string;
  psdPath?: string | null;
  /** 現在 OFF（検出なし等で無効化）になっている感情ラベル。 */
  disabledEmotions?: string[];
  /** 無効化中の感情を「感情で指定」で選んだとき、その感情を有効化する。 */
  onEnableEmotion?: (key: string) => void;
  onOverrideChange?: () => void;
  /** 新規プリセット保存後、preset_names の更新を親へ通知する。 */
  onPresetsChanged?: (characterName: string, names: string[]) => void;
  children: ReactNode;
}

export function OverrideEditorProvider({
  voiceIndex,
  analysisItem,
  characterName,
  presetNames,
  availableFiles,
  basePresetName,
  tachieType = "png",
  psdPath = null,
  disabledEmotions = [],
  onEnableEmotion,
  onOverrideChange,
  onPresetsChanged,
  children,
}: ProviderProps) {
  const [specMode, setSpecMode] = useState<SpecMode>("preset");
  const [overridePreset, setOverridePresetState] = useState("");
  const [emotionOrder, setEmotionOrder] = useState<string[]>([]);
  const [emotionTier, setEmotionTierState] = useState<EmotionTier>("mid");
  const [partOverrides, setPartOverrides] = useState<Record<string, string>>({});
  const [psdLayerOverrides, setPsdLayerOverrides] = useState<Record<string, boolean>>({});
  const [holdPrevious, setHoldPrevious] = useState(false);
  const [scoresOpen, setScoresOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const sortedPresets = [...presetNames].sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));

  useEffect(() => {
    let cancelled = false;
    setSpecMode("emotion"); // 既定は「感情で指定」（運用頻度が高いため）
    setOverridePresetState("");
    setEmotionOrder([]);
    setEmotionTierState("mid");
    setPartOverrides({});
    setPsdLayerOverrides({});
    setHoldPrevious(false);
    setScoresOpen(false);
    if (voiceIndex == null) return;
    api
      .getOverrides()
      .then((r) => {
        if (cancelled) return;
        const o = r.overrides[String(voiceIndex)] || r.overrides[voiceIndex as unknown as string];
        if (o) {
          if (o.hold_previous) setHoldPrevious(true);
          if (o.emotion_labels && o.emotion_labels.length) {
            setSpecMode("emotion");
            setEmotionOrder(o.emotion_labels);
            if (o.emotion_tier === "weak" || o.emotion_tier === "mid" || o.emotion_tier === "strong") {
              setEmotionTierState(o.emotion_tier);
            }
          } else if (o.preset_name) {
            setSpecMode("preset"); // プリセット上書きが保存済みなら復元
            setOverridePresetState(o.preset_name);
          }
          if (o.part_overrides) {
            // 空文字（=パーツなし）は UI 上のセンチネルへ変換して区別する。
            const mapped: Record<string, string> = {};
            Object.entries(o.part_overrides).forEach(([k, v]) => {
              mapped[k] = v === "" ? NONE_PART : v;
            });
            setPartOverrides(mapped);
          }
          if (o.psd_layer_overrides) {
            setPsdLayerOverrides(o.psd_layer_overrides);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [voiceIndex]);

  // 全変更はデバウンス自動保存に一本化。snapshot を明示的に渡して stale を回避。
  function scheduleSave(s: Snapshot) {
    if (voiceIndex == null) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const cp: Record<string, string> = {};
        Object.entries(s.partOverrides).forEach(([k, v]) => {
          if (v === NONE_PART) cp[k] = ""; // 明示的にパーツなし（バックエンドで消去）
          else if (v) cp[k] = v;
        });
        const hasParts = Object.keys(cp).length > 0;
        const psd = s.psdLayerOverrides || {};
        const hasPsd = Object.keys(psd).length > 0;
        if (s.specMode === "emotion") {
          if (s.emotionOrder.length === 0 && !hasParts && !hasPsd) {
            await api.deleteOverride(voiceIndex);
          } else {
            await api.setOverride(voiceIndex, {
              emotion_labels: s.emotionOrder,
              // 強弱は第1感情のみ選択時に有効（複数選択時はバックエンドで無視される）。
              emotion_tier: s.emotionOrder.length === 1 ? s.emotionTier : undefined,
              part_overrides: hasParts ? cp : undefined,
              psd_layer_overrides: hasPsd ? psd : undefined,
              locked: true,
            });
          }
        } else {
          const presetToUse = s.overridePreset || analysisItem?.resolution?.preset_name || "";
          if (!s.overridePreset && !hasParts && !hasPsd) {
            await api.deleteOverride(voiceIndex);
          } else {
            await api.setOverride(voiceIndex, {
              preset_name: presetToUse,
              part_overrides: hasParts ? cp : undefined,
              psd_layer_overrides: hasPsd ? psd : undefined,
              locked: true,
            });
          }
        }
        onOverrideChange?.();
      } catch {
        // non-fatal
      }
    }, 450);
  }

  function setOverridePreset(name: string) {
    setOverridePresetState(name);
    scheduleSave({ specMode: "preset", overridePreset: name, emotionOrder, emotionTier, partOverrides, psdLayerOverrides });
  }

  function toggleEmotion(key: string) {
    setEmotionOrder((prev) => {
      let next: string[];
      if (prev.includes(key)) next = prev.filter((k) => k !== key);
      else if (prev.length >= 3) next = prev;
      else next = [...prev, key];
      // 追加された感情が「無効化中（検出なしで自動OFF等）」なら、その感情を有効化する
      // （感情マッピングに行が出るようにし、自動OFFも解除する）。
      const added = !prev.includes(key) && next.includes(key);
      if (added && disabledEmotions.includes(key)) onEnableEmotion?.(key);
      scheduleSave({ specMode: "emotion", overridePreset, emotionOrder: next, emotionTier, partOverrides, psdLayerOverrides });
      return next;
    });
  }

  function setEmotionTier(tier: EmotionTier) {
    setEmotionTierState(tier);
    scheduleSave({ specMode: "emotion", overridePreset, emotionOrder, emotionTier: tier, partOverrides, psdLayerOverrides });
  }

  function setPart(field: string, value: string) {
    setPartOverrides((prev) => {
      const next = { ...prev };
      if (value) next[field] = value;
      else delete next[field];
      scheduleSave({ specMode, overridePreset, emotionOrder, emotionTier, partOverrides: next, psdLayerOverrides });
      return next;
    });
  }

  /** PSDレイヤーのパーツ個別変更デルタを丸ごと差し替えて保存（PsdLayerPanel から）。 */
  function setPsdLayers(next: Record<string, boolean>) {
    setPsdLayerOverrides(next);
    scheduleSave({ specMode, overridePreset, emotionOrder, emotionTier, partOverrides, psdLayerOverrides: next });
  }

  async function selectMode(hold: boolean) {
    if (hold === holdPrevious || voiceIndex == null) return;
    setSaving(true);
    try {
      if (hold) {
        await api.setOverride(voiceIndex, { hold_previous: true });
        setHoldPrevious(true);
        setOverridePresetState("");
        setEmotionOrder([]);
        setEmotionTierState("mid");
        setPartOverrides({});
        setPsdLayerOverrides({});
      } else {
        await api.deleteOverride(voiceIndex);
        setHoldPrevious(false);
      }
      onOverrideChange?.();
    } finally {
      setSaving(false);
    }
  }

  async function resetOverride() {
    if (voiceIndex == null) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaving(true);
    try {
      await api.deleteOverride(voiceIndex);
      setOverridePresetState("");
      setEmotionOrder([]);
      setEmotionTierState("mid");
      setPartOverrides({});
      setPsdLayerOverrides({});
      onOverrideChange?.();
    } finally {
      setSaving(false);
    }
  }

  // 解析の解決結果が無い場合（未解析・解析失敗・状態が古い等）でも、プリセットが
  // 存在すれば「既定プリセット→先頭プリセット」にフォールバックして必ずプレビューを出す。
  // これにより PSD/PNG とも、クリック時に「プリセット未解決」で固まらない。
  const resolvedPreset = analysisItem?.resolution?.preset_name || "";
  const fallbackPreset = basePresetName || sortedPresets[0] || "";
  const effectivePreset =
    specMode === "emotion"
      ? resolvedPreset || fallbackPreset
      : overridePreset || resolvedPreset || fallbackPreset;
  const hasAnyPartOverride = Object.values(partOverrides).some((v) => v);

  const value: OverrideEditorValue = {
    voiceIndex,
    analysisItem,
    characterName,
    presetNames,
    sortedPresets,
    availableFiles: availableFiles || {},
    basePresetName,
    tachieType,
    psdPath,
    specMode,
    setSpecMode,
    overridePreset,
    emotionOrder,
    emotionTier,
    partOverrides,
    psdLayerOverrides,
    holdPrevious,
    scoresOpen,
    setScoresOpen,
    saving,
    effectivePreset,
    hasAnyPartOverride,
    setOverridePreset,
    toggleEmotion,
    setEmotionTier,
    setPart,
    setPsdLayers,
    selectMode,
    resetOverride,
    onPresetsChanged,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
