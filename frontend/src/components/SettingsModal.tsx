"use client";

import { useEffect, useState } from "react";
import { api, getAppVersion, openExternalUrl, pickExePath } from "@/lib/api";

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

export default function SettingsModal({ exePath, onExePathChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(exePath);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [version, setVersion] = useState("");
  // 感情分析モデル
  const [emotionModel, setEmotionModel] = useState("local");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [modelSaving, setModelSaving] = useState(false);
  const [modelSavedMsg, setModelSavedMsg] = useState("");

  // Sync draft when opening or when the upstream value changes
  useEffect(() => {
    if (open) {
      setDraft(exePath);
      setSavedMsg("");
      setModelSavedMsg("");
      getAppVersion().then(setVersion).catch(() => setVersion(""));
      // Load current model/key from saved config.
      api
        .autoLoadConfig()
        .then((cfg) => {
          setEmotionModel((cfg.settings?.emotion_model as string) || "local");
          setLlmApiKey((cfg.settings?.llm_api_key as string) || "");
        })
        .catch(() => {});
    }
  }, [open, exePath]);

  async function handleBrowse() {
    const picked = await pickExePath();
    if (picked) setDraft(picked);
  }

  async function handleSaveModel() {
    setModelSaving(true);
    setModelSavedMsg("");
    try {
      await api.updateSettings({ emotion_model: emotionModel, llm_api_key: llmApiKey.trim() });
      setModelSavedMsg("保存しました");
    } catch (e) {
      setModelSavedMsg(`保存に失敗しました: ${(e as Error).message}`);
    } finally {
      setModelSaving(false);
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost"
        title="設定"
        style={{ fontSize: "0.95rem", color: "var(--text-muted)", padding: "4px 8px", lineHeight: 1 }}
      >
        {/* gear icon */}
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
          <div className="panel w-full max-w-3xl max-h-[85vh] overflow-y-auto p-8 animate-fadeIn" style={{ background: "var(--bg-panel)" }}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="display-text" style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", fontWeight: 600, color: "var(--accent)" }}>
                設定
              </h2>
              <button onClick={() => setOpen(false)} className="btn-ghost" style={{ fontSize: "1.25rem", color: "var(--text-muted)" }}>
                &times;
              </button>
            </div>

            <div className="grid grid-cols-2 gap-8" style={{ color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: "1.7" }}>
              {/* 左カラム: YMM4 exe パス */}
              <div>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 600, color: "var(--accent)", marginBottom: "8px" }}>
                  YMM4 の場所
                </h3>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                  YukkuriMovieMaker.exe のパスを指定すると、立ち絵のデフォルト状態を YMM4 の設定から取得してプレビューに反映します。
                </p>
                <div className="flex gap-2 mb-2">
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
                <div className="flex items-center gap-3">
                  <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ fontSize: "0.8rem", padding: "6px 16px" }}>
                    {saving ? "保存中..." : "保存"}
                  </button>
                  {savedMsg && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{savedMsg}</span>
                  )}
                </div>
              </div>

              {/* 右カラム: バージョン情報 / バグ報告 */}
              <div>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 600, color: "var(--accent)", marginBottom: "8px" }}>
                  バージョン情報
                </h3>
                <ul className="list-none space-y-1 mb-6" style={{ paddingLeft: 0 }}>
                  <li style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                    YMM4 EmotionMaker KIT
                  </li>
                  <li className="mono-text" style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
                    v{version || "—"}
                  </li>
                </ul>

                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 600, color: "var(--accent)", marginBottom: "8px" }}>
                  バグ報告
                </h3>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                  不具合や要望は共通フォームからお寄せください。
                </p>
                <button
                  onClick={() => openExternalUrl(NOTION_BUG_REPORT_URL)}
                  className="btn-secondary"
                  style={{ fontSize: "0.8rem", padding: "6px 14px" }}
                >
                  バグ報告フォームを開く ↗
                </button>
              </div>
            </div>

            {/* 感情分析モデル（全幅） */}
            <div style={{ borderTop: "1px solid var(--border-dim)", marginTop: "24px", paddingTop: "20px", color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: "1.7" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 600, color: "var(--accent)", marginBottom: "8px" }}>
                感情分析モデル
              </h3>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                台詞の感情分析に使うモデルを選択します。ローカル (BERT) は無料・オフラインで動作します。LLM を選ぶ場合は対応する API キーが必要です。
              </p>
              <div className="flex gap-2 items-center mb-2" style={{ flexWrap: "wrap" }}>
                <select
                  value={emotionModel}
                  onChange={(e) => setEmotionModel(e.target.value)}
                  className="select-field"
                  style={{ fontSize: "0.8rem", minWidth: "240px" }}
                >
                  {MODEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
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
              <div className="flex items-center gap-3 mt-2">
                <button onClick={handleSaveModel} disabled={modelSaving} className="btn-primary" style={{ fontSize: "0.8rem", padding: "6px 16px" }}>
                  {modelSaving ? "保存中..." : "保存"}
                </button>
                {modelSavedMsg && (
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{modelSavedMsg}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
