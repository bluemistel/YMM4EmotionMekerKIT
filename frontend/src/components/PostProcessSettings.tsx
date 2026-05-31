"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";

interface PostProcessConfig {
  postprocess_enabled: boolean;
  decay_rate: number;
  gradient_sudden_threshold: number;
  gradient_gradual_window: number;
  gradient_gradual_max_delta: number;
}

interface Props {
  settings: PostProcessConfig;
  onSettingsChange: (settings: PostProcessConfig) => void;
}

export default function PostProcessSettings({ settings, onSettingsChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  async function handleToggle(enabled: boolean) {
    const updated = { ...settings, postprocess_enabled: enabled };
    onSettingsChange(updated);
    await saveSettings(updated);
  }

  // 詳細数値の変更は即時更新＋デバウンス自動保存（保存ボタン不要）。
  function handleChange(key: keyof PostProcessConfig, value: number) {
    const updated = { ...settings, [key]: value };
    onSettingsChange(updated);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveSettings(updated).catch(() => {});
    }, 600);
  }

  async function saveSettings(s: PostProcessConfig) {
    await api.updateSettings({
      postprocess_enabled: s.postprocess_enabled,
      decay_rate: s.decay_rate,
      gradient_sudden_threshold: s.gradient_sudden_threshold,
      gradient_gradual_window: s.gradient_gradual_window,
      gradient_gradual_max_delta: s.gradient_gradual_max_delta,
    });
  }

  return (
    <div className="panel p-5 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.postprocess_enabled}
              onChange={(e) => handleToggle(e.target.checked)}
              className="checkbox-custom"
            />
            <span style={{ fontFamily: "var(--font-display)", fontSize: "0.9rem", fontWeight: 500, color: "var(--text-primary)" }}>
              感情後処理
            </span>
          </label>
          <span className="label-hint" style={{ marginLeft: 0 }}>勾配・減衰</span>
          {settings.postprocess_enabled && (
            <span className="badge" style={{ background: "var(--em-happiness-bg)", color: "var(--em-happiness)", border: "1px solid #48c87830", fontSize: "0.625rem" }}>
              有効
            </span>
          )}
        </div>
        {settings.postprocess_enabled && (
          <button onClick={() => setExpanded(!expanded)} className="btn-ghost">
            {expanded ? "▲ 閉じる" : "▼ 詳細設定"}
          </button>
        )}
      </div>

      {settings.postprocess_enabled && expanded && (
        <div className="animate-fadeIn" style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-dim)" }}>
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-dim)",
              borderRadius: "8px",
              padding: "10px 12px",
              marginBottom: "14px",
              fontSize: "0.74rem",
              lineHeight: "1.6",
              color: "var(--text-secondary)",
            }}
          >
            <p style={{ marginBottom: "6px" }}>
              <strong style={{ color: "var(--text-primary)" }}>感情後処理</strong> は、各台詞を独立に判定する標準フローの後に「直前までの感情の余韻」と「感情の動きの大きさ」を踏まえて表情を選び直すレイヤーです。
            </p>
            <ul style={{ listStyle: "none", paddingLeft: 0, marginTop: "4px" }}>
              <li style={{ marginBottom: "3px" }}>
                <strong style={{ color: "var(--gradient-sudden)" }}>急変</strong>: 直前との差が大きい行に発火し、感情マッピングの「急変:◯」プリセットへ差し替えます（例: 突然驚いた時に専用の驚き顔）。
              </li>
              <li style={{ marginBottom: "3px" }}>
                <strong style={{ color: "var(--gradient-gradual)" }}>徐々</strong>: 同じ感情が複数行にわたり同方向へ少しずつ動いている時に発火し、「徐々:◯」プリセットへ差し替えます（例: じわじわ悲しみが増す表情）。
              </li>
              <li>
                <strong style={{ color: "var(--em-joy)" }}>減衰 (γ)</strong>: 直前の感情スコアを γ 倍して今の行へ足し込むことで「余韻」を作ります。大怒り直後に突然無表情へ戻る不自然さを抑える目的です。
              </li>
            </ul>
            <p style={{ marginTop: "6px", color: "var(--text-muted)" }}>
              既存の感情マッピングはそのまま使われ、急変・徐々が発火した行だけ別プリセットに置き換わります。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                減衰率 (γ)
                <span className="label-hint">0=余韻なし／0.3〜0.5推奨。前行スコア × γ を加算</span>
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={settings.decay_rate}
                onChange={(e) => handleChange("decay_rate", parseFloat(e.target.value) || 0)}
                className="input-sm"
                style={{ width: "80px" }}
              />
            </div>
            <div>
              <label className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                急変閾値
                <span className="label-hint">前行との差がこれ以上で「急変」判定（0.4=±40pt）</span>
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={settings.gradient_sudden_threshold}
                onChange={(e) => handleChange("gradient_sudden_threshold", parseFloat(e.target.value) || 0.4)}
                className="input-sm"
                style={{ width: "80px" }}
              />
            </div>
            <div>
              <label className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                漸変ウィンドウ
                <span className="label-hint">同方向の小さな変化が N 行続けば「徐々」判定（3〜4 推奨）</span>
              </label>
              <input
                type="number"
                step="1"
                min="2"
                max="10"
                value={settings.gradient_gradual_window}
                onChange={(e) => handleChange("gradient_gradual_window", parseInt(e.target.value) || 3)}
                className="input-sm"
                style={{ width: "80px" }}
              />
            </div>
            <div>
              <label className="label-text" style={{ display: "block", marginBottom: "4px" }}>
                漸変最大デルタ
                <span className="label-hint">徐々と判定する 1 行あたりの上限変化量（≦この値で連続）</span>
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={settings.gradient_gradual_max_delta}
                onChange={(e) => handleChange("gradient_gradual_max_delta", parseFloat(e.target.value) || 0.15)}
                className="input-sm"
                style={{ width: "80px" }}
              />
            </div>
          </div>
          <p style={{ marginTop: "10px", fontSize: "0.7rem", color: "var(--text-faint)" }}>
            注意: 急変/徐々の差し替え先プリセットは「感情マッピング」の <strong>勾配プリセット</strong> 欄で感情ごとに設定してください。未設定の感情は通常のマッピング結果のまま出力されます。
          </p>
          <p style={{ marginTop: "8px", fontSize: "0.7rem", color: "var(--text-faint)", textAlign: "right" }}>
            変更は自動保存されます
          </p>
        </div>
      )}
    </div>
  );
}

export type { PostProcessConfig };
