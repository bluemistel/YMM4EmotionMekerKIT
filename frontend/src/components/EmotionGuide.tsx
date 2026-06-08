"use client";

import { AnalysisItem } from "@/lib/api";

const EMOTION_LABEL: Record<string, string> = {
  joy: "喜", anger: "怒", sadness: "哀", happiness: "楽", surprise: "驚き",
  embarrassment: "照れ", disgust: "嫌悪", fear: "恐れ", exasperation: "呆れ",
};
const EMOTION_COLOR: Record<string, string> = {
  joy: "var(--em-joy)", anger: "var(--em-anger)", sadness: "var(--em-sadness)",
  happiness: "var(--em-happiness)", surprise: "var(--em-surprise)",
  embarrassment: "var(--em-embarrassment)", disgust: "var(--em-disgust)",
  fear: "var(--em-fear)", exasperation: "var(--em-exasperation)",
};
const TIER_LABEL: Record<string, string> = { weak: "弱", mid: "中", strong: "強" };

interface Props {
  item: AnalysisItem | null;
}

function EmoChip({ k }: { k: string }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", padding: "1px 8px",
        borderRadius: "10px", fontSize: "0.78rem", fontWeight: 700, color: "#fff",
        background: EMOTION_COLOR[k] || "var(--text-faint)",
      }}
    >
      {EMOTION_LABEL[k] || k}
    </span>
  );
}

/** カラム3: 選択した台詞が「どの感情の組み合わせ/強弱に該当し、どのプリセットが割り当てられるか」を表示するガイド。 */
export default function EmotionGuide({ item }: Props) {
  const guide = item?.guide ?? null;

  return (
    <div className="panel p-4">
      {!item ? (
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "4px 2px" }}>
          上の一覧から台詞を選ぶと、判定された感情の組み合わせ・強弱と、割り当てられるプリセットを表示します。
        </p>
      ) : !guide ? (
        <p style={{ fontSize: "0.8rem", color: "var(--text-faint)", padding: "4px 2px" }}>
          このキャラクターは未設定のため判定できません。
        </p>
      ) : (
        <div className="space-y-2.5">
          {/* 該当ラベル */}
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ width: "92px", fontSize: "0.74rem", color: "var(--text-muted)", flexShrink: 0 }}>該当する感情</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {guide.kind === "default" && (
                <span style={{ fontSize: "0.8rem", color: "var(--text-faint)" }}>デフォルト（しきい値未満／該当なし）</span>
              )}
              {guide.kind === "preset" && (
                <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>プリセット直接指定</span>
              )}
              {guide.kind === "gradient" && (
                <>
                  <span style={{ fontSize: "0.74rem", color: "var(--text-faint)" }}>感情後処理</span>
                  <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", fontWeight: 700 }}>
                    {guide.gradient_type === "sudden" ? "急変" : "徐々"}
                  </span>
                  {guide.emotions[0] && <EmoChip k={guide.emotions[0]} />}
                </>
              )}
              {(guide.kind === "single") && guide.emotions[0] && (
                <>
                  <span style={{ fontSize: "0.74rem", color: "var(--text-faint)" }}>単独</span>
                  <EmoChip k={guide.emotions[0]} />
                  {guide.tier && (
                    <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", fontWeight: 700 }}>（{TIER_LABEL[guide.tier]}）</span>
                  )}
                </>
              )}
              {(guide.kind === "compound2" || guide.kind === "compound3") && (
                <>
                  <span style={{ fontSize: "0.74rem", color: "var(--text-faint)" }}>複合</span>
                  {guide.emotions.map((k, i) => (
                    <span key={k} className="flex items-center gap-1.5">
                      {i > 0 && <span style={{ color: "var(--text-faint)" }}>＋</span>}
                      <EmoChip k={k} />
                    </span>
                  ))}
                </>
              )}
              {guide.overridden && (
                <span
                  style={{
                    marginLeft: "4px", fontSize: "0.68rem", fontWeight: 700, color: "#fff",
                    background: "var(--accent)", borderRadius: "8px", padding: "1px 7px",
                  }}
                  title={guide.override_kind === "preset" ? "プリセットで指定（手動）" : "感情で指定（手動）"}
                >
                  ユーザー上書き
                </span>
              )}
            </div>
          </div>

          {/* 割り当てプリセット */}
          <div className="flex items-center gap-2">
            <span style={{ width: "92px", fontSize: "0.74rem", color: "var(--text-muted)", flexShrink: 0 }}>プリセット</span>
            {guide.preset_name ? (
              <span className="mono-text" style={{ fontSize: "0.82rem", color: "var(--accent)", fontWeight: 700 }}>{guide.preset_name}</span>
            ) : (
              <span style={{ fontSize: "0.8rem", color: "var(--em-anger)", fontWeight: 600 }}>未設定</span>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
