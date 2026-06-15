"use client";

import { useEffect, useState } from "react";
import { api, getAppVersion, openExternalUrl, pickExePath, checkLatestVersion, compareSemver, LatestVersionInfo } from "@/lib/api";
import LexiconPanel from "./LexiconPanel";
import PostProcessSettings, { PostProcessConfig } from "./PostProcessSettings";
import EmotionDonut from "./EmotionDonut";

const NOTION_BUG_REPORT_URL =
  "https://ionian-gallimimus-e47.notion.site/32b8c5bf8aa481978f37e470a25e1e01";

interface Props {
  /** 現在の YMM4 exe パス（config.settings.ymm4_exe_path） */
  exePath: string;
  /** 保存成功後に親へ通知（プレビュー再描画など） */
  onExePathChange: (path: string) => void;
}

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "local", label: "ローカル (BERT・無料)" },
  { value: "llm_claude", label: "LLM — Claude (API キー必要)" },
  { value: "llm_openai", label: "LLM — OpenAI (API キー必要)" },
];

const DETECTABLE_EMOTIONS: { key: string; label: string }[] = [
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

// OFF にすると 怒/驚/哀 への補助寄与も失われるラベル（事前警告対象）。
const SPILLOVER_EMOTIONS = new Set(["disgust", "fear"]);

type Section = "general" | "analysis" | "lexicon" | "about";

const NAV: { key: Section; label: string; icon: React.ReactNode }[] = [
  {
    key: "general",
    label: "全般",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
  {
    key: "analysis",
    label: "感情分析",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9.5" x2="9.01" y2="9.5" />
        <line x1="15" y1="9.5" x2="15.01" y2="9.5" />
      </svg>
    ),
  },
  {
    key: "lexicon",
    label: "感情辞書",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    ),
  },
  {
    key: "about",
    label: "バージョン情報",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
];

const SECTION_TITLE: Record<Section, string> = {
  general: "全般",
  analysis: "感情分析",
  lexicon: "感情辞書",
  about: "バージョン情報",
};

export default function SettingsModal({ exePath, onExePathChange }: Props) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("general");
  const [draft, setDraft] = useState(exePath);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [version, setVersion] = useState("");
  const [latestInfo, setLatestInfo] = useState<LatestVersionInfo | null>(null);
  const [checkingVersion, setCheckingVersion] = useState(false);
  // 感情分析モデル
  const [emotionModel, setEmotionModel] = useState("local");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [modelSaving, setModelSaving] = useState(false);
  const [modelSavedMsg, setModelSavedMsg] = useState("");
  // 分析の詳細（文脈・reader ブレンド）
  const [contextTurns, setContextTurns] = useState(2);
  const [speakerLabels, setSpeakerLabels] = useState(true);
  const [contextGapSeconds, setContextGapSeconds] = useState(0.4);
  const [readerWeight, setReaderWeight] = useState(0);
  const [intensityWeakMax, setIntensityWeakMax] = useState(0.5);
  const [intensityStrongMin, setIntensityStrongMin] = useState(0.83);
  const [disabledEmo, setDisabledEmo] = useState<Set<string>>(new Set());
  const [emoWarn, setEmoWarn] = useState("");
  const [showOptimizer, setShowOptimizer] = useState(true);
  const [autoDisableUndetected, setAutoDisableUndetected] = useState(true);
  // 複合感情の自動ミラー登録（全般タブ・既定ON。トグルで即保存）。
  const [compoundAutoMirror, setCompoundAutoMirror] = useState(true);
  // 個人適応学習(#1)
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);
  const [personalizationStrength, setPersonalizationStrength] = useState(0.5);
  const [trainingTotal, setTrainingTotal] = useState<number | null>(null);
  const [trainingTrainedAt, setTrainingTrainedAt] = useState<number | null>(null);
  const [trainingAcc, setTrainingAcc] = useState<number | null>(null);
  const [trainingCounts, setTrainingCounts] = useState<Record<string, number>>({});
  const [rebuilding, setRebuilding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [trainMsg, setTrainMsg] = useState("");
  const [postProcess, setPostProcess] = useState<PostProcessConfig>({
    postprocess_enabled: false,
    decay_rate: 0,
    gradient_sudden_threshold: 0.4,
    gradient_gradual_window: 3,
    gradient_gradual_max_delta: 0.15,
  });

  function loadSettings() {
    setDraft(exePath);
    setSavedMsg("");
    setModelSavedMsg("");
    getAppVersion().then(setVersion).catch(() => setVersion(""));
    api
      .autoLoadConfig()
      .then((cfg) => {
        const s = cfg.settings || {};
        setEmotionModel((s.emotion_model as string) || "local");
        setLlmApiKey((s.llm_api_key as string) || "");
        setContextTurns(typeof s.context_turns === "number" ? (s.context_turns as number) : 2);
        setSpeakerLabels(s.context_speaker_labels !== false);
        setContextGapSeconds(typeof s.context_gap_seconds === "number" ? (s.context_gap_seconds as number) : 0.4);
        setReaderWeight(typeof s.reader_weight === "number" ? (s.reader_weight as number) : 0);
        setIntensityWeakMax(typeof s.intensity_weak_max === "number" ? (s.intensity_weak_max as number) : 0.5);
        setIntensityStrongMin(typeof s.intensity_strong_min === "number" ? (s.intensity_strong_min as number) : 0.83);
        setDisabledEmo(new Set(Array.isArray(s.disabled_emotions) ? (s.disabled_emotions as string[]) : []));
        setEmoWarn("");
        setAutoDisableUndetected(s.auto_disable_undetected !== false);
        setShowOptimizer(s.show_optimizer_on_load !== false);
        setCompoundAutoMirror(s.compound_auto_mirror !== false);
        setPersonalizationEnabled(s.personalization_enabled === true);
        setPersonalizationStrength(typeof s.personalization_strength === "number" ? (s.personalization_strength as number) : 0.5);
        setPostProcess({
          postprocess_enabled: (s.postprocess_enabled as boolean) ?? false,
          decay_rate: (s.decay_rate as number) ?? 0,
          gradient_sudden_threshold: (s.gradient_sudden_threshold as number) ?? 0.4,
          gradient_gradual_window: (s.gradient_gradual_window as number) ?? 3,
          gradient_gradual_max_delta: (s.gradient_gradual_max_delta as number) ?? 0.15,
        });
      })
      .catch(() => {});
    api
      .getTrainingLabels()
      .then((r) => {
        setTrainingTotal(r.total);
        setTrainingTrainedAt(r.head?.trained_at ?? null);
        setTrainingAcc(r.head?.holdout_acc ?? null);
        setTrainingCounts(r.counts || {});
      })
      .catch(() => {});
  }

  // Sync when opening or when the upstream value changes
  useEffect(() => {
    if (open) loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exePath]);

  // バージョン情報タブを開いたとき、GitHub の公開タグと比較して更新有無を確認。
  useEffect(() => {
    if (!open || section !== "about") return;
    setCheckingVersion(true);
    setLatestInfo(null);
    checkLatestVersion()
      .then(setLatestInfo)
      .finally(() => setCheckingVersion(false));
  }, [open, section]);

  // 「詳細設定」ボタン等からの直接遷移（CustomEvent: open-settings, detail.section）。
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { section?: Section } | undefined;
      setSection(detail?.section || "general");
      setOpen(true);
    }
    window.addEventListener("open-settings", onOpen as EventListener);
    return () => window.removeEventListener("open-settings", onOpen as EventListener);
  }, []);

  async function handleBrowse() {
    const picked = await pickExePath();
    if (picked) setDraft(picked);
  }

  function toggleEmotion(key: string, enabled: boolean) {
    setDisabledEmo((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.delete(key);
      } else {
        next.add(key);
        if (SPILLOVER_EMOTIONS.has(key)) {
          setEmoWarn(
            "「嫌悪／恐れ」を無効にすると、これらに由来する 怒り・驚き・哀 への補助信号も無くなり、それらの検出がわずかに下がる場合があります。"
          );
        }
      }
      return next;
    });
  }

  async function handleSaveModel() {
    setModelSaving(true);
    setModelSavedMsg("");
    try {
      await api.updateSettings({
        emotion_model: emotionModel,
        llm_api_key: llmApiKey.trim(),
        context_turns: contextTurns,
        context_speaker_labels: speakerLabels,
        context_gap_seconds: contextGapSeconds,
        reader_weight: readerWeight,
        intensity_weak_max: intensityWeakMax,
        intensity_strong_min: intensityStrongMin,
        disabled_emotions: Array.from(disabledEmo),
        auto_disable_undetected: autoDisableUndetected,
        show_optimizer_on_load: showOptimizer,
        personalization_enabled: personalizationEnabled,
        personalization_strength: personalizationStrength,
      });
      setModelSavedMsg("保存しました（再分析で反映）");
    } catch (e) {
      setModelSavedMsg(`保存に失敗しました: ${(e as Error).message}`);
    } finally {
      setModelSaving(false);
    }
  }

  async function handleRebuildPersonalization() {
    setRebuilding(true);
    setTrainMsg("");
    try {
      const r = await api.rebuildPersonalization();
      if (r.trained) {
        setTrainingTotal(r.total);
        setTrainingTrainedAt(Date.now() / 1000);
        setTrainingAcc(r.holdout_acc ?? null);
        if (r.counts) setTrainingCounts(r.counts);
        setTrainMsg(`学習完了：累計 ${r.total} 件${r.holdout_acc != null ? `／概算一致率 ${(r.holdout_acc * 100).toFixed(0)}%` : ""}`);
      } else {
        setTrainMsg(r.reason === "insufficient_data" ? "学習データが不足しています（各感情に数件以上）。" : "学習をスキップしました。");
      }
    } catch (e) {
      setTrainMsg(`学習に失敗: ${(e as Error).message}`);
    } finally {
      setRebuilding(false);
    }
  }

  async function handleClearTraining() {
    if (!window.confirm("個人学習データ（手ラベルと学習済みモデル）をすべて削除して初期化します。\nこの操作は取り消せません。よろしいですか？")) {
      return;
    }
    setClearing(true);
    setTrainMsg("");
    try {
      await api.clearTrainingLabels();
      setTrainingTotal(0);
      setTrainingTrainedAt(null);
      setTrainingAcc(null);
      setTrainingCounts({});
      setTrainMsg("個人学習データを初期化しました（分析は基本モデルに戻ります）。");
    } catch (e) {
      setTrainMsg(`初期化に失敗: ${(e as Error).message}`);
    } finally {
      setClearing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSavedMsg("");
    try {
      await api.updateSettings({ ymm4_exe_path: draft.trim() });
      onExePathChange(draft.trim());
      setSavedMsg("保存しました");
    } catch (e) {
      setSavedMsg(`保存に失敗しました: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const h3 = { fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 600, color: "var(--accent)", marginBottom: "8px" } as React.CSSProperties;

  return (
    <>
      <button
        onClick={() => { setSection("general"); setOpen(true); }}
        className="btn-ghost"
        title="設定"
        style={{ fontSize: "0.95rem", color: "var(--text-muted)", padding: "4px 8px", lineHeight: 1 }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ verticalAlign: "-3px" }}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "#000000b0", backdropFilter: "blur(8px)" }}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="panel w-full max-w-4xl max-h-[85vh] overflow-hidden p-0 animate-fadeIn flex" style={{ background: "var(--bg-panel)" }}>
            {/* 左ナビ */}
            <div style={{ width: "172px", flexShrink: 0, borderRight: "1px solid var(--border-dim)", background: "var(--bg-surface)", padding: "20px 10px" }}>
              <h2 className="display-text" style={{ fontFamily: "var(--font-display)", fontSize: "1.0rem", fontWeight: 700, color: "var(--accent)", padding: "0 8px", marginBottom: "14px" }}>
                設定
              </h2>
              <nav className="space-y-1">
                {NAV.map((item) => {
                  const on = section === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSection(item.key)}
                      className="flex items-center gap-2.5 w-full"
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: 0,
                        cursor: "pointer",
                        fontSize: "0.82rem",
                        fontWeight: on ? 700 : 500,
                        background: on ? "var(--accent-soft)" : "transparent",
                        color: on ? "var(--accent)" : "var(--text-muted)",
                        textAlign: "left",
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* 右コンテンツ（スクロール領域 ＋ 下部固定の保存バー） */}
            <div className="flex-1 flex flex-col overflow-hidden" style={{ color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: "1.7" }}>
              <div className="flex-1 overflow-y-auto p-7" style={{ minHeight: 0 }}>
              <div className="flex justify-between items-center mb-5">
                <h3 className="display-text" style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)" }}>
                  {SECTION_TITLE[section]}
                </h3>
                <button onClick={() => setOpen(false)} className="btn-ghost" style={{ fontSize: "1.25rem", color: "var(--text-muted)" }}>
                  &times;
                </button>
              </div>

              {section === "general" && (
                <div>
                  <h3 style={h3}>複合感情</h3>
                  <label className="flex items-center gap-2 cursor-pointer mb-1" style={{ fontSize: "0.82rem" }}>
                    <input
                      type="checkbox"
                      checked={compoundAutoMirror}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setCompoundAutoMirror(v);
                        api.updateSettings({ compound_auto_mirror: v }).catch(() => {});
                      }}
                      className="checkbox-custom"
                    />
                    <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
                      複合感情の自動ミラー登録
                    </span>
                  </label>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "20px" }}>
                    複合感情にプリセットを登録すると、入れ替えた順序（例「喜+驚」→「驚+喜」、3感情は全6順列）へ自動で同じプリセットを登録します。実行時はスコア順でキーが決まるため、全順列を埋めておくと確実に反映されます。
                  </p>

                  <h3 style={h3}>YMM4 の場所</h3>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                    YukkuriMovieMaker.exe のパスを指定すると、立ち絵のデフォルト状態を YMM4 の設定から取得してプレビューに反映します。
                  </p>
                  <div className="flex gap-2 mb-2" style={{ maxWidth: "560px" }}>
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="C:\\...\\YukkuriMovieMaker.exe"
                      className="input-field flex-1"
                      style={{ fontSize: "0.78rem" }}
                    />
                    <button onClick={handleBrowse} className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px", whiteSpace: "nowrap" }}>
                      参照
                    </button>
                  </div>
                </div>
              )}

              {section === "analysis" && (
                <div>
                  {/* 自動最適化ウィザードの表示切替 */}
                  <label className="flex items-center gap-2 cursor-pointer mb-1" style={{ fontSize: "0.82rem" }}>
                    <input
                      type="checkbox"
                      checked={showOptimizer}
                      onChange={(e) => setShowOptimizer(e.target.checked)}
                      className="checkbox-custom"
                    />
                    <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
                      プロジェクト読み込み後に感情分析の自動最適化ウィンドウを表示する
                    </span>
                  </label>
                  <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginBottom: "16px" }}>
                    用途に合わせた設問に答えると、文脈・メリハリ・後処理を自動調整して分析します（保存で反映）。
                  </p>

                  <h3 style={h3}>感情分析モデル</h3>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                    台詞の感情分析に使うモデルを選択します。ローカル (BERT) は無料・オフラインで動作します。LLM を選ぶ場合は対応する API キーが必要です。
                  </p>
                  <div className="flex gap-2 items-center mb-2" style={{ flexWrap: "wrap" }}>
                    <select value={emotionModel} onChange={(e) => setEmotionModel(e.target.value)} className="select-field" style={{ fontSize: "0.8rem", minWidth: "240px" }}>
                      {MODEL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  {emotionModel !== "local" && (
                    <div className="mb-2 animate-fadeIn">
                      <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                        {emotionModel === "llm_claude" ? "Anthropic API キー" : "OpenAI API キー"}
                      </span>
                      <input
                        type="password"
                        value={llmApiKey}
                        onChange={(e) => setLlmApiKey(e.target.value)}
                        placeholder={emotionModel === "llm_claude" ? "sk-ant-..." : "sk-..."}
                        className="input-field w-full"
                        style={{ fontSize: "0.78rem", maxWidth: "420px" }}
                        autoComplete="off"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-4" style={{ maxWidth: "560px" }}>
                    <div>
                      <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                        文脈ターン数
                        <span className="label-hint">分析時に直前の発話を何件含めるか（0–5、推奨1–2）</span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={contextTurns}
                        onChange={(e) => setContextTurns(Math.max(0, Math.min(5, parseInt(e.target.value) || 0)))}
                        className="input-sm"
                        style={{ width: "72px" }}
                      />
                    </div>
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: "20px" }}>
                        <input type="checkbox" checked={speakerLabels} onChange={(e) => setSpeakerLabels(e.target.checked)} className="checkbox-custom" />
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>話者名で文脈を区別する</span>
                      </label>
                    </div>
                    <div>
                      <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                        文脈ギャップ（秒）
                        <span className="label-hint">台詞間にこの長さ以上の無音があると場面の区切りとみなし、文脈・余韻を持ち越さない。0=どんな短い間でも区切る(1F・テンポ重視)／大きいほど短い間は無視して流れを優先(キャラの間重視)。FPSでフレーム換算</span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={contextGapSeconds}
                        onChange={(e) => setContextGapSeconds(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="input-sm"
                        style={{ width: "84px" }}
                      />
                    </div>
                    <div></div>
                    <div className="col-span-2">
                      <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                        reader ブレンド: <span className="mono-text">{readerWeight.toFixed(2)}</span>
                        <span className="label-hint">0=書き手の感情 / 1=視聴者から見た感情。立ち絵の見えに合わせて調整</span>
                      </span>
                      <input type="range" min={0} max={1} step={0.05} value={readerWeight} onChange={(e) => setReaderWeight(parseFloat(e.target.value))} style={{ width: "100%", maxWidth: "420px" }} />
                    </div>
                    <div className="col-span-2">
                      <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                        感情の強度しきい値（弱 / 強）
                        <span className="label-hint">単独感情のスコアで「弱・中・強」を切り替える境界。スコア&lt;弱=弱、強≦スコア=強、その間=中。強度別プリセット（弱/中/強）の選択に使用</span>
                      </span>
                      <div className="flex items-center gap-5" style={{ maxWidth: "420px" }}>
                        <label style={{ flex: 1, fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                          弱のしきい値 &lt; <span className="mono-text">{intensityWeakMax.toFixed(2)}</span>
                          <input
                            type="range" min={0.05} max={0.95} step={0.01} value={intensityWeakMax}
                            onChange={(e) => setIntensityWeakMax(Math.min(parseFloat(e.target.value), intensityStrongMin - 0.01))}
                            style={{ width: "100%", marginTop: "2px" }}
                          />
                        </label>
                        <label style={{ flex: 1, fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                          強のしきい値 ≧ <span className="mono-text">{intensityStrongMin.toFixed(2)}</span>
                          <input
                            type="range" min={0.05} max={0.95} step={0.01} value={intensityStrongMin}
                            onChange={(e) => setIntensityStrongMin(Math.max(parseFloat(e.target.value), intensityWeakMax + 0.01))}
                            style={{ width: "100%", marginTop: "2px" }}
                          />
                        </label>
                      </div>
                      <p style={{ fontSize: "0.7rem", color: "var(--text-faint)", marginTop: "3px" }}>
                        既定値は WRIME 基準（弱 0.50 / 強 0.83）。
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    {/* 検出されない感情を自動OFF（既定ON） */}
                    <label className="flex items-center gap-2 cursor-pointer mb-2" style={{ fontSize: "0.82rem" }}>
                      <input
                        type="checkbox"
                        checked={autoDisableUndetected}
                        onChange={(e) => setAutoDisableUndetected(e.target.checked)}
                        className="checkbox-custom"
                      />
                      <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>検出されない感情ラベルを自動OFF</span>
                    </label>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginBottom: "8px" }}>
                      ON のとき、分析で出現しなかった感情を自動で無効化します（チェックは自動制御＝編集不可）。OFF にすると手動で選べます。
                    </p>

                    <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                      検出する感情ラベル
                      <span className="label-hint">台本に出ない感情を OFF にすると誤検出と複合感情の組合せを減らせます</span>
                    </span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5" style={{ maxWidth: "560px", opacity: autoDisableUndetected ? 0.55 : 1 }}>
                      {DETECTABLE_EMOTIONS.map((em) => {
                        const enabled = !disabledEmo.has(em.key);
                        return (
                          <label key={em.key} className="flex items-center gap-1.5" style={{ fontSize: "0.8rem", cursor: autoDisableUndetected ? "default" : "pointer" }}>
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={autoDisableUndetected}
                              onChange={(e) => toggleEmotion(em.key, e.target.checked)}
                              className="checkbox-custom"
                            />
                            <span style={{ color: enabled ? "var(--text-secondary)" : "var(--text-faint)" }}>
                              {em.label}
                              {SPILLOVER_EMOTIONS.has(em.key) && <span style={{ color: "var(--text-faint)" }}> *</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginTop: "4px" }}>
                      * 嫌悪・恐れは 怒/驚/哀 の検出を補助しています。
                    </p>
                    {!autoDisableUndetected && emoWarn && (
                      <p className="animate-fadeIn" style={{ fontSize: "0.75rem", color: "var(--gradient-sudden)", marginTop: "4px", lineHeight: 1.6 }}>
                        ⚠ {emoWarn}
                      </p>
                    )}
                  </div>

                  {/* 個人適応学習(#1) */}
                  <div style={{ borderTop: "1px solid var(--border-dim)", marginTop: "20px", paddingTop: "16px" }}>
                    <label className="flex items-center gap-2 cursor-pointer mb-2" style={{ fontSize: "0.82rem" }}>
                      <input
                        type="checkbox"
                        checked={personalizationEnabled}
                        onChange={(e) => setPersonalizationEnabled(e.target.checked)}
                        className="checkbox-custom"
                      />
                      <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>個人学習を使う（手ラベルに適応）</span>
                    </label>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginBottom: "8px" }}>
                      初期画面の「学習データ用として読み込み」で台詞にラベルを付け「学習を再構築」すると、以後の分析がそのラベル傾向に寄ります（ローカルBERT時のみ）。
                    </p>
                    <div style={{ maxWidth: "420px", opacity: personalizationEnabled ? 1 : 0.55 }}>
                      <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                        補正の強さ: <span className="mono-text">{personalizationStrength.toFixed(2)}</span>
                        <span className="label-hint">大きいほど学習結果を強く反映（データ量でも自動調整）</span>
                      </span>
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={personalizationStrength}
                        disabled={!personalizationEnabled}
                        onChange={(e) => setPersonalizationStrength(parseFloat(e.target.value))}
                        style={{ width: "100%", maxWidth: "420px" }}
                      />
                    </div>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <button onClick={handleRebuildPersonalization} disabled={rebuilding || clearing} className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}>
                        {rebuilding ? "学習中…" : "学習を再構築"}
                      </button>
                      <button
                        onClick={handleClearTraining}
                        disabled={clearing || rebuilding || (trainingTotal ?? 0) === 0}
                        className="btn-ghost"
                        style={{ fontSize: "0.76rem", padding: "5px 12px", color: "var(--em-anger)", border: "1px solid var(--em-anger)", borderRadius: "6px" }}
                        title="過学習したと感じたときに、手ラベルと学習済みモデルを全削除して初期化します"
                      >
                        {clearing ? "初期化中…" : "個人学習データを初期化"}
                      </button>
                      <span style={{ fontSize: "0.73rem", color: "var(--text-muted)" }}>
                        累計ラベル {trainingTotal ?? "—"} 件
                        {trainingTrainedAt ? `／学習済み` : "／未学習"}
                        {trainingAcc != null && `（概算一致率 ${(trainingAcc * 100).toFixed(0)}%）`}
                      </span>
                    </div>
                    {trainMsg && <p style={{ fontSize: "0.73rem", color: "var(--text-secondary)", marginTop: "4px" }}>{trainMsg}</p>}
                    {(trainingTotal ?? 0) > 0 && (
                      <div className="mt-3">
                        <span className="label-text" style={{ display: "block", marginBottom: "6px" }}>
                          ラベル登録バランス
                          <span className="label-hint">8感情の偏りを確認しながらバランス良く登録できます（呆れは辞書/学習頼りのため件数表示）</span>
                        </span>
                        <EmotionDonut counts={trainingCounts} />
                      </div>
                    )}
                  </div>

                  {/* 感情後処理（このセクションの最下部） */}
                  <div style={{ borderTop: "1px solid var(--border-dim)", marginTop: "20px", paddingTop: "16px" }}>
                    <PostProcessSettings settings={postProcess} onSettingsChange={setPostProcess} />
                  </div>
                </div>
              )}

              {section === "lexicon" && <LexiconPanel />}

              {section === "about" && (
                <div>
                  <h3 style={h3}>バージョン情報</h3>
                  <ul className="list-none space-y-1 mb-6" style={{ paddingLeft: 0 }}>
                    <li style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>YMM4 EmotionMaker KIT</li>
                    <li className="mono-text" style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>v{version || "—"}</li>
                  </ul>

                  {/* 最新バージョン確認（GitHub の公開タグと比較） */}
                  <div
                    className="mb-6"
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-dim)",
                      borderRadius: "8px",
                      padding: "12px 14px",
                    }}
                  >
                    {checkingVersion ? (
                      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>最新バージョンを確認中…</p>
                    ) : !latestInfo ? (
                      <p style={{ fontSize: "0.8rem", color: "var(--text-faint)" }}>—</p>
                    ) : !latestInfo.ok || !latestInfo.latest ? (
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p style={{ fontSize: "0.8rem", color: "var(--text-faint)" }}>
                          最新バージョンを確認できませんでした（オフライン等）。
                        </p>
                        <button
                          onClick={() => {
                            setCheckingVersion(true);
                            setLatestInfo(null);
                            checkLatestVersion().then(setLatestInfo).finally(() => setCheckingVersion(false));
                          }}
                          className="btn-secondary"
                          style={{ fontSize: "0.76rem", padding: "5px 12px" }}
                        >
                          再確認
                        </button>
                      </div>
                    ) : compareSemver(latestInfo.latest, version || "0") > 0 ? (
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p style={{ fontSize: "0.82rem", color: "var(--accent)", fontWeight: 700 }}>
                          新しいバージョン v{latestInfo.latest} が公開されています
                        </p>
                        <button
                          onClick={() => openExternalUrl(latestInfo.download_url)}
                          className="btn-primary"
                          style={{ fontSize: "0.8rem", padding: "6px 16px" }}
                        >
                          ダウンロードページを開く ↗
                        </button>
                      </div>
                    ) : (
                      <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                        お使いのバージョン（v{version}）は最新です ✓
                      </p>
                    )}
                  </div>

                  <h3 style={h3}>更新内容</h3>
                  <div className="mb-6" style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <p className="mono-text" style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: "4px" }}>v1.0.7</p>
                    <ul className="list-none space-y-1.5 mb-4" style={{ paddingLeft: 0 }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>パーツ個別変更をプリセットとして保存</strong>：「パーツ個別変更」で調整した状態に名前を付けて、YMM4 立ち絵プリセット（動く立ち絵の preset.ini／PSDの -ymm.json）の末尾へ追加登録。登録後はファイルを再読み込みしてアプリに即反映（YMM4 はプリセット一覧を起動中に保持するため、YMM4 を終了した状態での登録を推奨）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>複合感情の自動ミラー登録</strong>：複合感情にプリセットを登録すると、入れ替えた順序（例「喜+驚」→「驚+喜」、3感情は全6順列）へ自動で同じプリセットを登録（設定→全般で切替・既定ON）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>設定画面の保存ボタンを下部に常駐</strong>：スクロールが必要な場合でも「保存」ボタンが常に下部に表示され、保存のし忘れを防止</li>
                    </ul>
                    <p className="mono-text" style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: "4px" }}>v1.0.6</p>
                    <ul className="list-none space-y-1.5 mb-4" style={{ paddingLeft: 0 }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>Python不要で起動</strong>：バックエンドを同梱し、Python 未導入の環境でもそのまま動作（インストーラ版）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>PSDレイヤー切替を高速化</strong>：各レイヤーを事前生成して重ね合わせる方式に変更し、表示・非表示の切替を即時化（大きなPSDでも待ち時間なし）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>PSD表示の不具合修正</strong>：レイヤー番号のズレ、フォルダ非表示時に中のレイヤーが表示される問題、縦長立ち絵の表示比率、キャラクター設定でのPSD立ち絵の検出を修正</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>個人適応学習の精度・運用改善</strong>：YMM4制御タグの除去、辞書登録語の過学習防止、2層ヘッド化（データ量で自動切替）、登録バランスの円グラフ表示、個人学習データの初期化ボタンを追加</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>バージョン確認</strong>：設定のバージョン情報で最新版の有無を確認し、更新がある場合はダウンロード先を表示</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>最適化ウィザード</strong>：「会話のテンポと間」の文言を分かりやすく修正</li>
                    </ul>
                    <p className="mono-text" style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: "4px" }}>v1.0.4</p>
                    <ul className="list-none space-y-1.5 mb-4" style={{ paddingLeft: 0 }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>PSD立ち絵に対応</strong>：PSD規格の立ち絵（.psd ＋ -ymm.json プリセット）を読み込み、合成プレビューを表示</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>レイヤーでパーツ個別変更</strong>：PSD立ち絵はレイヤーの表示・非表示で調整。クリックで表示切替／中クリックでソロ表示／Ctrl・Shift＋ホイールで兄弟グループ送り（YMM4互換操作）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情マッピングは従来どおり</strong>：表情の割り当ては -ymm.json のプリセット登録状況に依存（PNG立ち絵と同じ操作感）</li>
                    </ul>
                    <p className="mono-text" style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: "4px" }}>v1.0.3</p>
                    <ul className="list-none space-y-1.5 mb-4" style={{ paddingLeft: 0 }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>個人適応学習</strong>：台詞に正解感情をラベル付けして蓄積すると、以後の分析がその傾向に適応します（初期画面の「学習データ用として読み込み」トグルでラベリング画面へ）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>キャラの性格マップ</strong>：キャラを感情価×覚醒度の2軸に配置し、感情の出やすさをキャラごとに方向付け</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>個人学習・性格マップ設定</strong>：感情マッピングと同様にアプリ共通設定として保存・復元</li>
                    </ul>
                    <p className="mono-text" style={{ color: "var(--text-secondary)", fontWeight: 600, marginBottom: "4px" }}>v1.0.2</p>
                    <ul className="list-none space-y-1.5" style={{ paddingLeft: 0 }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情分析精度の向上</strong>：話者名で文脈を区別／話し手・視聴者の感情調整（reader ブレンド）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>文脈ギャップ</strong>：無音区間の区切り秒数を追加し、文脈（場面）ごとに感情を分析</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情ラベルを追加</strong>：嫌悪・恐れ・呆れ（呆れは感情辞書の登録内容を元に検出。「まぁ」「えー」などの感動詞を入れると検出されやすくなります）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情辞書を追加</strong>：台詞に特定の語句が含まれるとき指定感情を強める（boost＝加算）／固定する（set）ルール</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>最適化ウィザード</strong>：プロジェクト読み込み時に、プロジェクトに合わせて分析精度を最適化する設問を追加</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>UI レイアウト調整</strong>：プレビュー／個別変更カラムを大型化して左カラムに独立配置、検出キャラクター設定をアイコン化</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>個別設定</strong>：感情ラベルの手動上書き（感情で指定・強度・パーツ個別変更）を追加</li>
                    </ul>
                  </div>

                  <h3 style={h3}>バグ報告</h3>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                    不具合や要望は共通フォームからお寄せください。
                  </p>
                  <button onClick={() => openExternalUrl(NOTION_BUG_REPORT_URL)} className="btn-secondary" style={{ fontSize: "0.8rem", padding: "6px 14px" }}>
                    バグ報告フォームを開く ↗
                  </button>
                </div>
              )}
              </div>{/* /スクロール領域 */}

              {/* 下部に常駐する保存バー（スクロールしても隠れない） */}
              {(section === "general" || section === "analysis") && (
                <div
                  className="flex items-center gap-3"
                  style={{
                    flexShrink: 0,
                    borderTop: "1px solid var(--border-dim)",
                    padding: "12px 28px",
                    background: "var(--bg-panel)",
                  }}
                >
                  {section === "general" ? (
                    <>
                      <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ fontSize: "0.8rem", padding: "6px 16px" }}>
                        {saving ? "保存中..." : "保存"}
                      </button>
                      {savedMsg && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{savedMsg}</span>}
                    </>
                  ) : (
                    <>
                      <button onClick={handleSaveModel} disabled={modelSaving} className="btn-primary" style={{ fontSize: "0.8rem", padding: "6px 16px" }}>
                        {modelSaving ? "保存中..." : "保存"}
                      </button>
                      {modelSavedMsg && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{modelSavedMsg}</span>}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Dot() {
  return <span style={{ color: "var(--accent)", marginRight: "8px", fontSize: "0.5rem", verticalAlign: "middle" }}>&#9679;</span>;
}
