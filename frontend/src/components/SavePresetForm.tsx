"use client";
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";

interface Props {
  /** 入力された名前で保存を実行し、更新後の preset_names を返す。 */
  onSave: (name: string) => Promise<string[]>;
  /** 保存成功後（新しい preset_names を受け取る）。 */
  onSaved?: (name: string, names: string[]) => void;
}

/** 「パーツ個別変更」の現在状態を新しい YMM4 プリセットとして名前付きで追記登録する UI。
 *  PNG/PSD 共通。保存処理本体は親が onSave で渡す。 */
export default function SavePresetForm({ onSave, onSaved }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSave() {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const names = await onSave(n);
      setMsg({ ok: true, text: `「${n}」を登録しました` });
      setName("");
      onSaved?.(n, names);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: "10px", marginTop: "10px" }}>
      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)" }}>
        プリセットとして保存
        <span className="label-hint">YMM4 立ち絵ファイルの末尾に新規登録します</span>
      </span>
      <div className="flex items-center gap-2 mt-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder="新しいプリセット名"
          className="select-field flex-1"
          style={{ fontSize: "0.72rem", minWidth: 0 }}
          disabled={saving}
        />
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="btn-primary"
          style={{ fontSize: "0.72rem", whiteSpace: "nowrap", padding: "6px 16px" }}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      {msg && (
        <p
          style={{
            fontSize: "0.72rem",
            marginTop: "6px",
            color: msg.ok ? "var(--accent)" : "var(--em-anger)",
          }}
        >
          {msg.text}
        </p>
      )}
      <p style={{ fontSize: "0.68rem", marginTop: "6px", color: "var(--text-faint)", lineHeight: 1.6 }}>
        ※ YMM4 はプリセット一覧を起動中にメモリ保持するため、<b>YMM4 を終了した状態で登録</b>してください。
        起動中に登録すると反映されず、YMM4 側の保存で上書きされる場合があります。登録後はその立ち絵の設定を YMM4 で変更しないでください。
      </p>
    </div>
  );
}
