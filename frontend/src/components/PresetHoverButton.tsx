"use client";

import { useEffect, useRef, useState } from "react";
import PresetPreview from "./PresetPreview";

interface Props {
  characterName: string;
  presetName: string;
  basePresetName?: string | null;
  label?: string;
}

const POPOVER_W = 360;
const POPOVER_H = 380;
const HIDE_DELAY_MS = 150;

export default function PresetHoverButton({
  characterName,
  presetName,
  basePresetName,
  label = "preview",
}: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const hideTimer = useRef<number | null>(null);

  function cancelHide() {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      setPos(null);
      hideTimer.current = null;
    }, HIDE_DELAY_MS);
  }

  function show(e: React.MouseEvent) {
    cancelHide();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let x = r.right + 12;
    if (x + POPOVER_W > window.innerWidth - 8) {
      x = Math.max(8, r.left - POPOVER_W - 12);
    }
    const y = Math.max(8, Math.min(r.top, window.innerHeight - POPOVER_H - 8));
    setPos({ x, y });
  }

  useEffect(() => () => cancelHide(), []);

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <button
        type="button"
        className="btn-ghost"
        style={{ color: "var(--cyan)", fontSize: "0.7rem" }}
      >
        {label}
      </button>
      {pos && (
        <div
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            zIndex: 60,
            width: `${POPOVER_W}px`,
            background: "var(--bg-panel)",
            border: "1px solid var(--border-base)",
            borderRadius: "10px",
            boxShadow: "0 8px 28px #16302f26",
            padding: "14px",
            pointerEvents: "auto",
          }}
          className="animate-fadeIn"
        >
          <PresetPreview
            characterName={characterName}
            presetName={presetName}
            basePresetName={basePresetName}
            zoomable
            viewKey="hover-preview"
          />
        </div>
      )}
    </span>
  );
}
