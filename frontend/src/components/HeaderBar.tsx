"use client";

import { useState } from "react";
import { ProjectInfo } from "@/lib/api";
import HelpModal from "./HelpModal";
import SettingsModal from "./SettingsModal";

interface Props {
  project?: ProjectInfo | null;
  onReload?: () => void;
  /** 作業状態を保存。保存したパスを返す（キャンセル時は null）。 */
  onSaveWorkstate?: () => Promise<string | null>;
  exePath?: string;
  onExePathChange?: (path: string) => void;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export default function HeaderBar({ project, onReload, onSaveWorkstate, exePath = "", onExePathChange }: Props) {
  const [savingState, setSavingState] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  async function handleSaveWorkstate() {
    if (!onSaveWorkstate) return;
    setSavingState(true);
    setSavedMsg("");
    try {
      const p = await onSaveWorkstate();
      if (p) {
        setSavedMsg("保存しました");
        setTimeout(() => setSavedMsg(""), 2500);
      }
    } catch {
      setSavedMsg("保存に失敗しました");
      setTimeout(() => setSavedMsg(""), 3000);
    } finally {
      setSavingState(false);
    }
  }

  return (
    <header
      className="flex items-center justify-between px-6 py-3"
      style={{
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border-dim)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "var(--accent)",
            display: "inline-block",
          }}
        />
        <h1
          className="display-text"
          style={{ fontSize: "1.1rem", fontWeight: 900, letterSpacing: "0.03em", color: "var(--text-primary)" }}
        >
          YMM4 EmotionMaker <span style={{ color: "var(--accent)" }}>KIT</span>
        </h1>
      </div>

      <div className="flex items-center gap-3">
        {project && (
          <div
            className="flex items-center gap-2.5"
            style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}
          >
            <span className="mono-text" style={{ color: "var(--text-primary)", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {baseName(project.path)}
            </span>
            <span style={{ color: "var(--text-faint)" }}>·</span>
            <span>{project.voice_count} 台詞</span>
            <span style={{ color: "var(--text-faint)" }}>·</span>
            <span>{project.characters.length} キャラ</span>
            {project.video_info?.FPS ? (
              <>
                <span style={{ color: "var(--text-faint)" }}>·</span>
                <span>{project.video_info.FPS}fps</span>
              </>
            ) : null}
            {onSaveWorkstate && (
              <button
                onClick={handleSaveWorkstate}
                disabled={savingState}
                className="btn-secondary"
                style={{ marginLeft: "6px", fontSize: "0.76rem", padding: "5px 12px" }}
                title="現在の設定・上書き・分析結果を作業状態ファイルに保存します"
              >
                {savingState ? "保存中…" : "💾 作業状態を保存"}
              </button>
            )}
            {savedMsg && (
              <span style={{ fontSize: "0.74rem", color: "var(--accent)", whiteSpace: "nowrap" }}>{savedMsg}</span>
            )}
            {onReload && (
              <button onClick={onReload} className="btn-secondary" style={{ marginLeft: "2px", fontSize: "0.76rem", padding: "5px 12px" }}>
                ↻ 再読込
              </button>
            )}
          </div>
        )}
        <HelpModal />
        <SettingsModal exePath={exePath} onExePathChange={(p) => onExePathChange?.(p)} />
      </div>
    </header>
  );
}
