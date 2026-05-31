"use client";

import { PlacementItem } from "@/lib/api";

const DEFAULT_COLORS = [
  "var(--em-sadness)",
  "var(--em-happiness)",
  "var(--em-joy)",
  "var(--em-anger)",
  "var(--em-surprise)",
  "var(--em-embarrassment)",
  "var(--cyan)",
  "var(--gradient-sudden)",
];

interface Props {
  placements: PlacementItem[] | null;
  totalFrames: number;
  characterColors?: Record<string, string>;
  playheadFrame?: number | null;
}

export default function TimelinePreview({
  placements,
  totalFrames,
  characterColors,
  playheadFrame,
}: Props) {
  if (!placements || placements.length === 0) return null;

  const chars = [...new Set(placements.map((p) => p.character_name))];
  const charColorMap: Record<string, string> = {};
  chars.forEach((c, i) => {
    charColorMap[c] = characterColors?.[c] || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
  });

  const maxFrame = totalFrames || Math.max(...placements.map((p) => p.frame + p.length));
  const playheadLeft =
    playheadFrame != null && maxFrame > 0
      ? Math.min(100, Math.max(0, (playheadFrame / maxFrame) * 100))
      : null;

  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color: "var(--accent)", fontSize: "0.68rem" }}>&#9670;</span>
        <h2 className="section-title">タイムライン</h2>
        {playheadLeft != null && (
          <span style={{ fontSize: "0.74rem", color: "var(--accent)", fontWeight: 700, marginLeft: "4px" }}>
            選択台詞の位置を表示中
          </span>
        )}
      </div>

      <div className="flex gap-3 mb-3 flex-wrap" style={{ fontSize: "0.7rem" }}>
        {chars.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "2px",
                background: charColorMap[c],
              }}
            />
            <span style={{ color: "var(--text-secondary)" }}>{c.split("_")[0]}</span>
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {chars.map((charName) => {
          const charPlacements = placements.filter(
            (p) => p.character_name === charName
          );
          return (
            <div
              key={charName}
              className="relative overflow-hidden"
              style={{
                height: "30px",
                background: "var(--bg-surface)",
                borderRadius: "6px",
                border: "1px solid var(--border-dim)",
              }}
            >
              {charPlacements.map((p, i) => {
                const left = (p.frame / maxFrame) * 100;
                const width = Math.max((p.length / maxFrame) * 100, 0.5);
                return (
                  <div
                    key={i}
                    className="absolute transition-opacity duration-100"
                    style={{
                      top: "2px",
                      bottom: "2px",
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: charColorMap[charName],
                      borderRadius: "3px",
                      opacity: 0.82,
                    }}
                    title={`${p.preset_name}\nF${p.frame}-${p.frame + p.length}\n${p.source_serifs.join(" / ")}`}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.82"; }}
                  >
                    <span className="mono-text block truncate" style={{ fontSize: "8px", color: "#ffffff", padding: "0 3px", lineHeight: "26px", textShadow: "0 0 2px rgba(0,0,0,0.4)" }}>
                      {p.preset_name}
                    </span>
                  </div>
                );
              })}
              {playheadLeft != null && (
                <div
                  style={{
                    position: "absolute",
                    top: "-1px",
                    bottom: "-1px",
                    left: `${playheadLeft}%`,
                    width: "2px",
                    background: "var(--accent)",
                    boxShadow: "0 0 0 1px #ffffff, 0 0 5px var(--accent)",
                    zIndex: 5,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3" style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>
        {placements.length} 件の表情アイテム / {maxFrame} フレーム
      </div>
    </div>
  );
}
