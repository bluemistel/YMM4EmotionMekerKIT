"use client";
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SceneInfo } from "@/lib/api";

interface Props {
  scenes: SceneInfo[];
  current: number;
  analyzing: number | null;
  onSelect: (index: number) => void;
}

/** YMM4 のシーン（タイムライン）切替タブ。ボイスを含むシーンのみ表示し、
 *  タブ切替で対象シーンを自動分析する（分析中はタブに「解析中…」を表示）。 */
export default function SceneTabBar({ scenes, current, analyzing, onSelect }: Props) {
  if (scenes.length <= 1) return null;
  return (
    <div className="panel" style={{ padding: "10px 12px" }}>
      <div className="flex items-center gap-2 mb-2 px-1">
        <span style={{ color: "var(--accent)", fontSize: "0.68rem" }}>&#9670;</span>
        <h2 className="section-title">シーン</h2>
        <span style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>
          タブを切り替えると、そのシーンを自動で感情分析します
        </span>
      </div>
      <div
        className="flex gap-1 overflow-x-auto"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-dim)", borderRadius: "9px", padding: "4px" }}
      >
        {scenes.map((s) => {
          const on = s.index === current;
          const busy = analyzing === s.index;
          return (
            <button
              key={s.index}
              onClick={() => onSelect(s.index)}
              title={`${s.name}（${s.voice_count} ボイス）`}
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                gap: "7px",
                padding: "7px 14px",
                border: 0,
                borderRadius: "6px",
                background: on ? "var(--accent)" : "transparent",
                color: on ? "#ffffff" : "var(--text-muted)",
                fontFamily: "var(--font-body)",
                fontSize: "0.82rem",
                fontWeight: on ? 700 : 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              <span>{s.name}</span>
              <span
                style={{
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  opacity: busy ? 1 : 0.7,
                  color: busy ? (on ? "#ffffff" : "var(--accent)") : "inherit",
                }}
              >
                {busy ? "解析中…" : s.voice_count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
