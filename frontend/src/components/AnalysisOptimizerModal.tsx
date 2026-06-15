"use client";

import { useEffect, useState } from "react";

export interface OptimizerInitial {
  kakeai: boolean;          // 掛け合い重視
  readerWeight: number;     // 0.0 / 0.2 / 0.5
  postprocess: boolean;     // 感情後処理
  contextGapSeconds: number; // 場面境界の無音ギャップ秒（テンポ/間）
}

interface Props {
  open: boolean;
  initial: OptimizerInitial;
  /** 「この設定で分析開始」: 設定パッチを渡す。 */
  onStart: (patch: Record<string, unknown>) => void;
  /** 「スキップ」/×: 現在設定のまま分析へ。 */
  onSkip: () => void;
}

const MERIHARI: { value: number; label: string; desc: string }[] = [
  { value: 0.0, label: "メリハリ重視", desc: "感情の振れ幅を強く出す（writer 寄り）" },
  { value: 0.2, label: "バランス", desc: "標準（既定）" },
  { value: 0.5, label: "安定重視", desc: "穏やか・行ごとの変化を抑える（reader 寄り）" },
];

function nearestMerihari(w: number): number {
  if (w <= 0.1) return 0.0;
  if (w <= 0.35) return 0.2;
  return 0.5;
}

const TEMPO: { value: number; label: string; desc: string }[] = [
  { value: 0.0, label: "テンポ重視", desc: "台詞間に空けた間（1F以上）をすべて場面の区切りにする（テンポよく細かく切り替える）" },
  { value: 0.4, label: "バランス", desc: "標準。明確な間で場面を区切る（既定）" },
  { value: 1.0, label: "キャラの間重視", desc: "キャラがしっかり取った大きな間（長い無音）だけを場面の区切りにし、短い間は流れとして繋ぐ" },
];

function nearestTempo(sec: number): number {
  if (sec <= 0.2) return 0.0;
  if (sec <= 0.7) return 0.4;
  return 1.0;
}

const NOTE = "0.78rem";

/** プロジェクト読み込み後に出す「感情分析の最適化」設問ウィザード。
 *  動画の用途を答えると内部設定（文脈/話者/reader/後処理）へ反映して分析する。 */
export default function AnalysisOptimizerModal({ open, initial, onStart, onSkip }: Props) {
  const [kakeai, setKakeai] = useState(true);
  const [merihari, setMerihari] = useState(0.2);
  const [postprocess, setPostprocess] = useState(false);
  const [tempo, setTempo] = useState(0.4);

  useEffect(() => {
    if (open) {
      setKakeai(initial.kakeai);
      setMerihari(nearestMerihari(initial.readerWeight));
      setPostprocess(initial.postprocess);
      setTempo(nearestTempo(initial.contextGapSeconds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function handleStart() {
    onStart({
      context_turns: kakeai ? 1 : 0,
      context_speaker_labels: kakeai,
      reader_weight: merihari,
      postprocess_enabled: postprocess,
      context_gap_seconds: tempo,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "#000000b0", backdropFilter: "blur(8px)" }}
      onClick={(e) => e.target === e.currentTarget && onSkip()}
    >
      <div className="panel w-full max-w-2xl max-h-[88vh] overflow-y-auto p-7 animate-fadeIn" style={{ background: "var(--bg-panel)" }}>
        <div className="flex justify-between items-start mb-2">
          <h2 className="display-text" style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", fontWeight: 600, color: "var(--accent)" }}>
            感情分析の最適化
          </h2>
          <button onClick={onSkip} className="btn-ghost" style={{ fontSize: "1.25rem", color: "var(--text-muted)" }} title="スキップ">
            &times;
          </button>
        </div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "20px", lineHeight: 1.7 }}>
          動画の雰囲気に合わせて答えると、感情分析の設定を自動調整してから分析します。あとから「設定 ＞ 感情分析」で手動変更もできます。
        </p>

        <div className="space-y-6" style={{ color: "var(--text-secondary)" }}>
          {/* Q1 掛け合い重視 */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={kakeai} onChange={(e) => setKakeai(e.target.checked)} className="checkbox-custom" />
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>掛け合い重視</span>
            </label>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.7 }}>
              キャラ同士の会話で、相手のフリへのリアクション感情を重視します。1人の朗読・ナレーション主体なら OFF。
            </p>
            <p style={{ fontSize: NOTE, color: "var(--text-faint)", marginTop: "2px" }}>
              対応設定: 「文脈ターン数」(ON=1/OFF=0) ＋「話者名で文脈を区別する」(ON/OFF)
            </p>
          </div>

          {/* Q2 メリハリ（reader） */}
          <div>
            <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>感情表現のメリハリ</span>
            <div className="flex gap-1 mt-2" style={{ background: "var(--bg-surface)", borderRadius: "8px", padding: "3px", maxWidth: "440px" }}>
              {MERIHARI.map((m) => {
                const on = merihari === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMerihari(m.value)}
                    style={{
                      flex: 1,
                      fontSize: "0.8rem",
                      fontWeight: on ? 700 : 500,
                      padding: "7px 8px",
                      borderRadius: "6px",
                      border: 0,
                      cursor: "pointer",
                      background: on ? "var(--accent)" : "transparent",
                      color: on ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.7 }}>
              {MERIHARI.find((m) => m.value === merihari)?.desc}
            </p>
            <p style={{ fontSize: NOTE, color: "var(--text-faint)", marginTop: "2px" }}>
              対応設定: 「reader ブレンド」（メリハリ重視=0.0 / バランス=0.2 / 安定重視=0.5）
            </p>
          </div>

          {/* Q3 会話のテンポ / キャラの間 */}
          <div>
            <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>会話のテンポと間（ま）</span>
            <div className="flex gap-1 mt-2" style={{ background: "var(--bg-surface)", borderRadius: "8px", padding: "3px", maxWidth: "440px" }}>
              {TEMPO.map((t) => {
                const on = tempo === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTempo(t.value)}
                    style={{
                      flex: 1,
                      fontSize: "0.8rem",
                      fontWeight: on ? 700 : 500,
                      padding: "7px 8px",
                      borderRadius: "6px",
                      border: 0,
                      cursor: "pointer",
                      background: on ? "var(--accent)" : "transparent",
                      color: on ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.7 }}>
              {TEMPO.find((t) => t.value === tempo)?.desc}
            </p>
            <p style={{ fontSize: NOTE, color: "var(--text-faint)", marginTop: "2px" }}>
              対応設定: 「文脈ギャップ（秒）」。台詞間にこの長さ以上の無音があると場面の区切りとみなし、前場面の文脈・余韻を持ち越しません（プロジェクトの FPS で秒→フレーム換算）。
            </p>
          </div>

          {/* Q4 感情後処理 */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={postprocess} onChange={(e) => setPostprocess(e.target.checked)} className="checkbox-custom" />
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>感情の余韻・流れを補正する</span>
            </label>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.7 }}>
              前の行の感情の余韻を残したり、急変・徐々の変化に専用表情を割り当てます。細かい数値は設定で調整できます。
            </p>
            <p style={{ fontSize: NOTE, color: "var(--text-faint)", marginTop: "2px" }}>
              対応設定: 「感情後処理（勾配・減衰）」の有効化（減衰率・急変閾値などは現在値を使用）
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-7">
          <button onClick={onSkip} className="btn-secondary" style={{ fontSize: "0.82rem", padding: "7px 16px" }}>
            スキップ（現在の設定で分析）
          </button>
          <button onClick={handleStart} className="btn-primary" style={{ fontSize: "0.85rem", padding: "8px 20px" }}>
            この設定で分析開始
          </button>
        </div>
      </div>
    </div>
  );
}
