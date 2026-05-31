"use client";

import { useState } from "react";

export default function HelpModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        使い方
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "#000000b0", backdropFilter: "blur(8px)" }}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            className="panel w-full max-w-3xl max-h-[85vh] overflow-y-auto p-8 animate-fadeIn"
            style={{ background: "var(--bg-panel)" }}
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="display-text" style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", fontWeight: 600, color: "var(--accent)" }}>
                使い方ガイド
              </h2>
              <button onClick={() => setOpen(false)} className="btn-ghost" style={{ fontSize: "1.25rem", color: "var(--text-muted)" }}>
                &times;
              </button>
            </div>

            <div className="space-y-6" style={{ color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: "1.8" }}>
              <Section title="概要">
                <p>
                  YMM4 EmotionMaker KIT は、ゆっくりムービーメーカー4のプロジェクトファイルに含まれる
                  台詞テキストを AI で感情分析し、キャラクターの表情（動く立ち絵のプリセット）を自動で配置するツールです。
                </p>
              </Section>

              <Section title="Step 1: プロジェクトを読み込む">
                <p>
                  画面上部にYMM4プロジェクトファイル（.ymmp）のフルパスを入力して「読込」をクリックします。
                </p>
                <Tip>YMM4 を閉じた状態で操作することをおすすめします。</Tip>
              </Section>

              <Section title="Step 2: キャラクター設定">
                <p>
                  読み込み後、左パネルにキャラクター一覧が表示されます。
                  動く立ち絵フォルダ内の preset.ini が自動検出されます。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot />preset.ini が見つからない場合は手動でパスを指定</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />「プリセット読込」でキャラクターの表情プリセットを読み込み</li>
                </ul>
              </Section>

              <Section title="Step 3: 感情マッピング設定">
                <p>
                  キャラクターを選択すると、感情マッピング設定が表示されます。
                  6つの基本感情に対応する表情プリセットを割り当てます。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot />ドロップダウンからプリセットを選択</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />複合感情（例：喜び＋恥ずかしさ）も設定可能</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />設定は自動保存</li>
                </ul>
              </Section>

              <Section title="Step 4: 感情分析を実行">
                <p>
                  右パネルの「感情分析」ボタンをクリックすると、全台詞テキストに対して
                  BERT モデルによる感情分析が実行されます。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot />初回実行時はモデルのダウンロードに時間がかかります</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />結果が不適切な場合、個別にオーバーライド可能</li>
                </ul>
              </Section>

              <Section title="Step 5: プレビュー確認">
                <p>
                  分析完了後、タイムラインプレビューで表情アイテムの配置を確認できます。
                </p>
              </Section>

              <Section title="Step 6: 実行（書き出し）">
                <p>
                  「書き出し」パネルで出力先を確認し、実行ボタンで表情アイテムをプロジェクトに書き出します。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot />デフォルトで「_emotion」を付けて保存</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />バックアップオプションで元ファイルを保護</li>
                </ul>
              </Section>

              <Section title="感情分析モデル">
                <ul className="list-none space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>ローカル（BERT）:</strong> オフラインで動作。WRIME v2 モデル</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>LLM:</strong> API キーが必要。より高精度な分析</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />モデルの選択と API キーの入力は、ヘッダー右上の <strong style={{ color: "var(--text-secondary)" }}>歯車アイコン → 設定 → 感情分析モデル</strong> から行えます。</li>
                </ul>
              </Section>

              <Section title="設定ファイル">
                <p>
                  設定は <code className="mono-text" style={{ background: "var(--bg-elevated)", padding: "1px 6px", borderRadius: "4px", fontSize: "0.8125rem" }}>backend/data/config.yaml</code> に自動保存されます。
                </p>
              </Section>

              <Section title="トラブルシューティング">
                <ul className="list-none space-y-2" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>プリセットが読み込めない：</strong> preset.ini のパスを確認</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情分析が遅い：</strong> 初回はモデルDL（約500MB）が必要</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>表情が期待と違う：</strong> オーバーライド機能で手動修正可能</li>
                </ul>
              </Section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 600, color: "var(--accent)", marginBottom: "8px", letterSpacing: "0.03em" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-ring)", borderRadius: "6px", padding: "8px 12px", color: "var(--accent-strong)", fontSize: "0.75rem" }}>
      {children}
    </div>
  );
}

function Dot() {
  return <span style={{ color: "var(--accent)", marginRight: "8px", fontSize: "0.5rem", verticalAlign: "middle" }}>&#9679;</span>;
}
