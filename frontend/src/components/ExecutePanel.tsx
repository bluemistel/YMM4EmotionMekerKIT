"use client";

import { useEffect, useState } from "react";
import { api, pickSavePath } from "@/lib/api";

interface Props {
  projectPath: string;
  hasAnalysis: boolean;
}

/** Force a path to end with .ymmp (append if missing, replace other ext). */
function ensureYmmp(p: string): string {
  const t = p.trim();
  if (!t) return t;
  if (/\.ymmp$/i.test(t)) return t;
  if (/\.[^\\/.]+$/.test(t)) return t.replace(/\.[^\\/.]+$/, ".ymmp");
  return t + ".ymmp";
}

export default function ExecutePanel({ projectPath, hasAnalysis }: Props) {
  // Default output: same folder as the loaded project, with a _emotion suffix.
  const defaultOutput = projectPath
    ? projectPath.replace(/\.ymmp$/i, "") + "_emotion.ymmp"
    : "";

  const [outputPath, setOutputPath] = useState(defaultOutput);
  const [backup, setBackup] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{
    status: string;
    output_path: string;
    face_items_count: number;
  } | null>(null);
  const [error, setError] = useState("");

  // Keep the field in sync with the loaded project's default path.
  useEffect(() => {
    setOutputPath(defaultOutput);
  }, [defaultOutput]);

  async function handleBrowse() {
    const picked = await pickSavePath(outputPath || defaultOutput);
    if (picked) setOutputPath(ensureYmmp(picked));
  }

  async function handleExecute() {
    setExecuting(true);
    setError("");
    setResult(null);
    try {
      const target = ensureYmmp(outputPath || defaultOutput);
      const res = await api.execute(0, target || undefined, backup);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 mb-4">
        <span style={{ color: "var(--accent)", fontSize: "0.68rem" }}>&#9670;</span>
        <h2 className="section-title">書き出し実行</h2>
      </div>

      <div className="space-y-3">
        <div>
          <label className="label-text" style={{ display: "block", marginBottom: "4px" }}>
            出力ファイルパス
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              onBlur={() => outputPath.trim() && setOutputPath(ensureYmmp(outputPath))}
              placeholder={defaultOutput || "出力先パスを入力..."}
              className="input-field flex-1"
            />
            <button
              onClick={handleBrowse}
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "5px 12px", whiteSpace: "nowrap" }}
            >
              名前を付けて保存…
            </button>
          </div>
          <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginTop: "4px" }}>
            既定は読み込んだプロジェクトと同じ場所に「_emotion」を付けた名前です。拡張子は常に <span className="mono-text">.ymmp</span> で出力されます。
          </p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={backup}
            onChange={(e) => setBackup(e.target.checked)}
            className="checkbox-custom"
          />
          <span style={{ color: "var(--text-secondary)" }}>バックアップを作成 (.ymmp.bak)</span>
        </label>

        <button
          onClick={handleExecute}
          disabled={executing || !hasAnalysis}
          className="w-full"
          style={{
            background: hasAnalysis ? "var(--accent)" : "var(--bg-elevated)",
            color: hasAnalysis ? "#ffffff" : "var(--text-faint)",
            fontWeight: 700,
            border: hasAnalysis ? "none" : "1px solid var(--border-dim)",
            borderRadius: "8px",
            padding: "10px 20px",
            fontSize: "0.9rem",
            cursor: hasAnalysis && !executing ? "pointer" : "not-allowed",
            opacity: executing ? 0.5 : 1,
            boxShadow: hasAnalysis ? "0 2px 10px #1f8a8233" : "none",
            transition: "all 0.2s",
            fontFamily: "var(--font-body)",
          }}
        >
          {executing
            ? "書き出し中..."
            : !hasAnalysis
              ? "先に感情分析を実行してください"
              : "表情アイテムを生成して書き出し"}
        </button>

        {error && (
          <p style={{ color: "var(--em-anger)", fontSize: "0.8125rem" }}>{error}</p>
        )}
        {result && (
          <div
            className="animate-fadeIn"
            style={{
              background: "var(--em-happiness-bg)",
              border: "1px solid #48c87830",
              borderRadius: "8px",
              padding: "14px",
              fontSize: "0.875rem",
            }}
          >
            <p style={{ color: "var(--em-happiness)", fontWeight: 700 }}>書き出し完了</p>
            <p className="mono-text" style={{ color: "var(--text-secondary)", marginTop: "6px", fontSize: "0.8rem" }}>
              {result.output_path}
            </p>
            <p style={{ color: "var(--text-secondary)", marginTop: "2px" }}>
              生成: <span className="mono-text" style={{ color: "var(--accent)", fontWeight: 700 }}>{result.face_items_count}</span> 件
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
