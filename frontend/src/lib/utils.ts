// SPDX-License-Identifier: AGPL-3.0-or-later
export function frameToTime(frame: number, fps: number): string {
  if (fps <= 0) return `F${frame}`;
  const totalSeconds = frame / fps;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = s.toFixed(2).padStart(5, "0");
  return `${hh}:${mm}:${ss}`;
}

export function frameToTimeWithFrame(frame: number, fps: number): string {
  return `${frameToTime(frame, fps)} (F${frame})`;
}
