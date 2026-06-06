"use client";

import { useMemo } from "react";

// 円グラフ対象は WRIME 由来の8感情（呆れ=exasperation は辞書/ユーザー学習頼りで
// 比率が偏るため円から除外し、件数で別表示する）。
const DONUT_EMOTIONS: { key: string; label: string; color: string }[] = [
  { key: "joy", label: "喜", color: "var(--em-joy)" },
  { key: "anger", label: "怒", color: "var(--em-anger)" },
  { key: "sadness", label: "哀", color: "var(--em-sadness)" },
  { key: "happiness", label: "楽", color: "var(--em-happiness)" },
  { key: "surprise", label: "驚き", color: "var(--em-surprise)" },
  { key: "embarrassment", label: "照れ", color: "var(--em-embarrassment)" },
  { key: "disgust", label: "嫌悪", color: "var(--em-disgust)" },
  { key: "fear", label: "恐れ", color: "var(--em-fear)" },
];
const EXASPERATION = { key: "exasperation", label: "呆れ", color: "var(--em-exasperation)" };

interface Props {
  counts: Record<string, number>;
  size?: number;
}

function polar(cx: number, cy: number, r: number, frac: number) {
  // frac: 0..1 を 12時起点・時計回りの角度に。
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** 個人学習ラベルの登録状況を示すドーナツ円グラフ（依存追加なしのインラインSVG）。 */
export default function EmotionDonut({ counts, size = 132 }: Props) {
  const { segments, total8 } = useMemo(() => {
    const vals = DONUT_EMOTIONS.map((e) => Math.max(0, counts[e.key] || 0));
    const sum = vals.reduce((a, b) => a + b, 0);
    const segs: { e: typeof DONUT_EMOTIONS[number]; v: number; start: number; end: number }[] = [];
    let acc = 0;
    DONUT_EMOTIONS.forEach((e, i) => {
      const v = vals[i];
      if (sum > 0 && v > 0) {
        const start = acc / sum;
        acc += v;
        segs.push({ e, v, start, end: acc / sum });
      } else {
        segs.push({ e, v, start: 0, end: 0 });
      }
    });
    return { segments: segs, total8: sum };
  }, [counts]);

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter * 0.58;
  const exCount = Math.max(0, counts[EXASPERATION.key] || 0);

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {total8 === 0 ? (
          <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="var(--border-dim)" strokeWidth={rOuter - rInner} />
        ) : (
          segments.map(({ e, v, start, end }) => {
            if (v <= 0) return null;
            const large = end - start > 0.5 ? 1 : 0;
            const [ox1, oy1] = polar(cx, cy, rOuter, start);
            const [ox2, oy2] = polar(cx, cy, rOuter, end);
            const [ix2, iy2] = polar(cx, cy, rInner, end);
            const [ix1, iy1] = polar(cx, cy, rInner, start);
            // フルサークル（単一クラスのみ）の退避: 1 にわずか足して弧で描く。
            const isFull = end - start >= 0.9999;
            const d = isFull
              ? `M ${ox1} ${oy1} A ${rOuter} ${rOuter} 0 1 1 ${ox1 - 0.01} ${oy1} ` +
                `M ${ix1} ${iy1} A ${rInner} ${rInner} 0 1 0 ${ix1 - 0.01} ${iy1} Z`
              : `M ${ox1} ${oy1} A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2} ${oy2} ` +
                `L ${ix2} ${iy2} A ${rInner} ${rInner} 0 ${large} 0 ${ix1} ${iy1} Z`;
            return <path key={e.key} d={d} fill={e.color} stroke="var(--bg-panel)" strokeWidth={1} />;
          })
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: "0.92rem", fontWeight: 700, fill: "var(--text-primary)" }}>
          {total8}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: "0.6rem", fill: "var(--text-faint)" }}>
          8感情
        </text>
      </svg>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
        {DONUT_EMOTIONS.map((e) => (
          <div key={e.key} className="flex items-center gap-1.5" style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            <span style={{ width: "9px", height: "9px", borderRadius: "2px", background: e.color, flexShrink: 0 }} />
            <span style={{ minWidth: "28px" }}>{e.label}</span>
            <span className="mono-text" style={{ color: "var(--text-secondary)" }}>{counts[e.key] || 0}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5" style={{ fontSize: "0.7rem", color: "var(--text-faint)", gridColumn: "1 / span 2", marginTop: "2px", borderTop: "1px solid var(--border-dim)", paddingTop: "3px" }}>
          <span style={{ width: "9px", height: "9px", borderRadius: "2px", background: EXASPERATION.color, opacity: 0.6, flexShrink: 0 }} />
          <span style={{ minWidth: "28px" }}>{EXASPERATION.label}</span>
          <span className="mono-text" style={{ color: "var(--text-secondary)" }}>{exCount}</span>
          <span style={{ marginLeft: "4px", color: "var(--text-faint)" }}>（辞書/学習頼りのため円グラフ外）</span>
        </div>
      </div>
    </div>
  );
}
