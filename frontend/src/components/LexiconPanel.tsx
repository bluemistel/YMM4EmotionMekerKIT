"use client";

import { useEffect, useState } from "react";
import { api, LexiconEntry } from "@/lib/api";

const EMOTIONS: { key: string; label: string }[] = [
  { key: "joy", label: "喜" },
  { key: "anger", label: "怒" },
  { key: "sadness", label: "哀" },
  { key: "happiness", label: "楽" },
  { key: "surprise", label: "驚き" },
  { key: "embarrassment", label: "照れ" },
  { key: "disgust", label: "嫌悪" },
  { key: "fear", label: "恐れ" },
  { key: "exasperation", label: "呆れ" },
];

function emptyEntry(): LexiconEntry {
  return { pattern: "", emotion: "joy", weight: 0.4, mode: "boost", char: null };
}

/** 語句→感情の補正辞書を編集するパネル（設定モーダル内に表示）。 */
export default function LexiconPanel() {
  const [entries, setEntries] = useState<LexiconEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    api.getLexicon().then((r) => setEntries(r.entries || [])).catch(() => setEntries([]));
  }, []);

  function update(i: number, patch: Partial<LexiconEntry>) {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function add() {
    setEntries((prev) => [...prev, emptyEntry()]);
  }
  function remove(i: number) {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    setSavedMsg("");
    try {
      const clean = entries.filter((e) => e.pattern.trim());
      const r = await api.updateLexicon(clean);
      setEntries(r.entries || clean);
      setSavedMsg("保存しました（再分析で反映）");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e) {
      setSavedMsg(`保存に失敗: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: "1.7" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 600, color: "var(--accent)", marginBottom: "8px" }}>
        感情辞書（語句→感情の補正）
      </h3>
      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "12px" }}>
        台詞に特定の語句が含まれるとき、指定した感情を強める（boost＝加算）／固定する（set）ルールです。口語のクセを反映できます。学習は不要で、分析結果に後段で適用されます。
      </p>

      <div className="space-y-2">
        {entries.length === 0 && (
          <p style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>ルールはまだありません。「＋ ルールを追加」で作成できます。</p>
        )}
        {entries.map((e, i) => (
          <div key={i} className="flex items-center gap-2" style={{ minWidth: 0 }}>
            <input
              type="text"
              value={e.pattern}
              onChange={(ev) => update(i, { pattern: ev.target.value })}
              placeholder="語句（例: やったー）"
              className="input-field"
              style={{ fontSize: "0.78rem", flex: "1 1 auto", minWidth: "60px" }}
            />
            <span className="flex-shrink-0" style={{ color: "var(--text-faint)" }}>→</span>
            <select
              value={e.emotion}
              onChange={(ev) => update(i, { emotion: ev.target.value })}
              className="select-field flex-shrink-0"
              style={{ fontSize: "0.78rem", width: "80px" }}
            >
              {EMOTIONS.map((em) => (
                <option key={em.key} value={em.key}>{em.label}</option>
              ))}
            </select>
            <select
              value={e.mode}
              onChange={(ev) => update(i, { mode: ev.target.value as "boost" | "set" })}
              className="select-field flex-shrink-0"
              style={{ fontSize: "0.78rem", width: "104px" }}
            >
              <option value="boost">強める(+)</option>
              <option value="set">固定(=)</option>
            </select>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={e.weight}
              onChange={(ev) => update(i, { weight: Math.max(0, Math.min(1, parseFloat(ev.target.value) || 0)) })}
              className="input-sm flex-shrink-0"
              style={{ width: "64px" }}
              title="強さ（0〜1）"
            />
            <input
              type="text"
              value={e.char ?? ""}
              onChange={(ev) => update(i, { char: ev.target.value.trim() || null })}
              placeholder="キャラ名(任意)"
              className="input-field flex-shrink-0"
              style={{ fontSize: "0.75rem", width: "110px" }}
            />
            <button
              onClick={() => remove(i)}
              className="btn-ghost flex-shrink-0"
              style={{ fontSize: "0.95rem", color: "var(--em-anger)", padding: "2px 6px", lineHeight: 1, marginLeft: "auto" }}
              title="この行を削除"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button onClick={add} className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}>
          ＋ ルールを追加
        </button>
        <button onClick={save} disabled={saving} className="btn-primary" style={{ fontSize: "0.8rem", padding: "6px 16px" }}>
          {saving ? "保存中..." : "辞書を保存"}
        </button>
        {savedMsg && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{savedMsg}</span>}
      </div>
    </div>
  );
}
