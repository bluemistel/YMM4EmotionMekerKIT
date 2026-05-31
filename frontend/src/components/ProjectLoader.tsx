"use client";

import { useState, useRef, useEffect } from "react";
import { api, pickYmmpPath, pickExePath, resolveDroppedPath } from "@/lib/api";

export type FlowPhase =
  | "idle"
  | "loading"
  | "detecting"
  | "analyzing"
  | "done"
  | "error";

interface Props {
  onRunPipeline: (path: string) => void;
  phase: FlowPhase;
  message: string;
  exePath?: string;
  onExePathChange?: (path: string) => void;
  /** 作業状態ファイル(.ymmemo)を選んで前回の状態を復元する */
  onLoadWorkstate?: () => void;
}

const STEPS: { key: FlowPhase; label: string }[] = [
  { key: "loading", label: "読込" },
  { key: "detecting", label: "キャラ検出" },
  { key: "analyzing", label: "感情分析" },
];

const ORDER: Record<FlowPhase, number> = {
  idle: -1,
  loading: 0,
  detecting: 1,
  analyzing: 2,
  done: 3,
  error: -1,
};

export default function ProjectLoader({ onRunPipeline, phase, message, exePath = "", onExePathChange, onLoadWorkstate }: Props) {
  const [path, setPath] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [hint, setHint] = useState("");
  const [exeDraft, setExeDraft] = useState(exePath);
  const [exeSaved, setExeSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = phase === "loading" || phase === "detecting" || phase === "analyzing";

  // exePath loads asynchronously on mount; keep the draft in sync until the
  // user has begun editing it.
  useEffect(() => {
    setExeDraft(exePath);
  }, [exePath]);

  async function saveExePath(p: string) {
    const trimmed = p.trim().replace(/^"|"$/g, "");
    setExeDraft(trimmed);
    try {
      await api.updateSettings({ ymm4_exe_path: trimmed });
      onExePathChange?.(trimmed);
      setExeSaved(true);
      setTimeout(() => setExeSaved(false), 2000);
    } catch {
      // non-fatal
    }
  }

  async function handleExeBrowse() {
    const picked = await pickExePath();
    if (picked) await saveExePath(picked);
  }

  function validateAndRun(p: string) {
    const trimmed = p.trim().replace(/^"|"$/g, "");
    if (!trimmed) return;
    if (!trimmed.toLowerCase().endsWith(".ymmp")) {
      setHint(".ymmp ファイルを指定してください");
      return;
    }
    setHint("");
    setPath(trimmed);
    onRunPipeline(trimmed);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const resolved = resolveDroppedPath(file);
    if (!resolved) {
      setHint("このファイルのパスを取得できませんでした（dev はパス入力をご利用ください）");
      return;
    }
    validateAndRun(resolved);
  }

  async function handlePick() {
    const picked = await pickYmmpPath();
    if (picked) validateAndRun(picked);
    else setHint("ファイルダイアログはデスクトップ版でのみ利用できます");
  }

  return (
    <div className="max-w-2xl mx-auto mt-16">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => !busy && handleDrop(e)}
        className="panel animate-fadeIn"
        style={{
          padding: "44px 40px",
          textAlign: "center",
          border: dragOver
            ? "2px dashed var(--accent)"
            : "2px dashed var(--border-strong)",
          background: dragOver ? "var(--accent-soft)" : "var(--bg-panel)",
          transition: "all 0.15s ease",
        }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.6"
          style={{ margin: "0 auto 14px" }}
        >
          <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
          <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
        </svg>
        <h2
          className="display-text"
          style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "6px", color: "var(--text-primary)" }}
        >
          .ymmp ファイルをここにドロップ
        </h2>
        <p style={{ fontSize: "0.83rem", color: "var(--text-muted)", marginBottom: "20px" }}>
          または下のボタン／パス入力から開けます。開くと自動で解析まで進みます。
        </p>

        <div className="flex gap-2.5 justify-center items-center flex-wrap">
          <button onClick={handlePick} disabled={busy} className="btn-primary">
            ファイルを選択
          </button>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder=".ymmp パスを入力（dev用）"
            disabled={busy}
            className="input-field"
            style={{ width: "320px" }}
            onKeyDown={(e) => e.key === "Enter" && !busy && validateAndRun(path)}
          />
          <button
            onClick={() => validateAndRun(path)}
            disabled={busy}
            className="btn-secondary"
          >
            読込んで解析
          </button>
        </div>

        {onLoadWorkstate && (
          <div className="mt-4 flex flex-col items-center gap-1.5">
            <button
              onClick={onLoadWorkstate}
              disabled={busy}
              className="btn-ghost"
              style={{ fontSize: "0.8rem", color: "var(--accent)" }}
            >
              ↩ 作業状態ファイル(.ymmemo)から復元
            </button>
            <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>
              前回保存した設定・上書き・分析結果をまとめて読み込みます。
            </span>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".ymmp"
          style={{ display: "none" }}
        />

        <div
          style={{
            marginTop: "22px",
            paddingTop: "18px",
            borderTop: "1px solid var(--border-dim)",
            textAlign: "left",
          }}
        >
          <span className="label-text" style={{ display: "block", marginBottom: "4px" }}>
            YMM4 (YukkuriMovieMaker.exe) の場所
          </span>
          <p style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginBottom: "8px" }}>
            デフォルト立ち絵の取得に使用します（後から設定で変更できます）。
          </p>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={exeDraft}
              onChange={(e) => setExeDraft(e.target.value)}
              onBlur={() => exeDraft.trim() && saveExePath(exeDraft)}
              onKeyDown={(e) => e.key === "Enter" && saveExePath(exeDraft)}
              placeholder="C:\\...\\YukkuriMovieMaker.exe"
              className="input-field flex-1"
              style={{ fontSize: "0.78rem" }}
            />
            <button
              onClick={handleExeBrowse}
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "5px 12px", whiteSpace: "nowrap" }}
            >
              参照
            </button>
            {exeSaved && (
              <span style={{ fontSize: "0.74rem", color: "var(--accent)", whiteSpace: "nowrap" }}>
                保存しました
              </span>
            )}
          </div>
        </div>

        {hint && (
          <p style={{ marginTop: "14px", fontSize: "0.8rem", color: "var(--em-anger)" }}>
            {hint}
          </p>
        )}

        {(busy || phase === "done" || phase === "error") && (
          <div
            className="flex items-center justify-center gap-2 mt-6"
            style={{ fontSize: "0.78rem" }}
          >
            {STEPS.map((s, i) => {
              const cur = ORDER[phase];
              const active = cur === i;
              const doneStep = cur > i;
              return (
                <span key={s.key} className="flex items-center gap-2">
                  <span
                    style={{
                      color: active
                        ? "var(--accent)"
                        : doneStep
                          ? "var(--accent)"
                          : "var(--text-faint)",
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    {active && <span className="spinner" style={{ marginRight: "6px", verticalAlign: "-2px" }} />}
                    {doneStep ? "● " : active ? "" : "○ "}
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span style={{ color: "var(--text-faint)" }}>→</span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {message && (busy || phase === "error") && (
          <p
            style={{
              marginTop: "12px",
              fontSize: "0.78rem",
              color: phase === "error" ? "var(--em-anger)" : "var(--text-muted)",
            }}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
