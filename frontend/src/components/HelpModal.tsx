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

              <Section title="Step 2: 分析の最適化ウィザード（自動表示）">
                <p>
                  プロジェクトを読み込むと、動画の作りに合わせて分析設定を調整する
                  「感情分析の最適化」ウィザードが自動で開きます。設問に答えて「この設定で分析開始」を押すと、最適化した設定で感情分析まで自動実行されます。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>掛け合い重視:</strong> 相手のフリへのリアクション感情を重視（文脈ターン数＋話者名で文脈を区別）</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情表現のメリハリ:</strong> 振れ幅を強く出すか穏やかにするか（reader ブレンド）</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>会話のテンポと間:</strong> 台詞間の無音をどの長さで「場面の区切り」とみなすか（文脈ギャップ）</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情の余韻・流れ:</strong> 前の行の余韻を残す／急変・徐々の変化に専用表情（後処理）</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />「スキップ」で現在の設定のまま分析。以降は <strong style={{ color: "var(--text-secondary)" }}>設定 → 感情分析</strong> で手動調整、表示ON/OFFも切替可能</li>
                </ul>
              </Section>

              <Section title="Step 3: キャラクター設定">
                <p>
                  中央カラムのアイコン（色＋頭文字）で検出キャラを選びます。動く立ち絵フォルダ内の
                  preset.ini が自動検出され、表情プリセットが読み込まれます。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot />preset.ini が見つからない場合は手動でパスを指定して「プリセット読込」</li>
                </ul>
              </Section>

              <Section title="Step 4: 感情マッピング設定">
                <p>
                  キャラクターを選択すると感情マッピングが表示されます。9つの感情
                  （喜・怒・哀・楽・驚き・照れ・嫌悪・恐れ・呆れ）に表情プリセットを割り当てます。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot />単独感情は <strong style={{ color: "var(--text-secondary)" }}>弱／中／強</strong> の強度別プリセットも任意設定（未設定は中）</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />複合感情（例：喜び＋照れ）、急変・徐々の勾配プリセットも設定可能</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />設定は自動保存</li>
                </ul>
              </Section>

              <Section title="Step 5: 結果確認と個別調整">
                <p>
                  右カラムに分析結果と感情バッジが並びます。台詞を選ぶと左カラムに大きなプレビューと
                  パーツ一覧、中央の「個別設定」タブで表情を上書きできます。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情で指定:</strong> 感情をクリック順に最大3つ（複合）。第1感情のみのときは強度（弱/中/強）も指定可</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>プリセットで指定:</strong> プリセットを直接選択</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>パーツ個別変更:</strong> 目・口などを個別に差し替え（変更すると [個別] マーク）</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>前回の表情を保つ:</strong> 新しい表情を作らず直前の表情を継続</li>
                </ul>
              </Section>

              <Section title="Step 6: 書き出し">
                <p>
                  ヘッダーの「書き出し」から出力先を確認し、実行で表情アイテムをプロジェクトに書き出します。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot />既定で「_emotion」を付けて保存。バックアップで元ファイルを保護</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />表情アイテムは同キャラの立ち絵が表示されている区間に合わせて配置・延長されます</li>
                </ul>
              </Section>

              <Section title="感情辞書（語句→感情の補正）">
                <p>
                  台詞に特定の語句が含まれるとき、指定した感情を <strong style={{ color: "var(--text-secondary)" }}>強める（boost＝加算）</strong> または
                  <strong style={{ color: "var(--text-secondary)" }}>固定する（set）</strong> ルールです（<strong style={{ color: "var(--text-secondary)" }}>設定 → 感情辞書</strong>）。口語のクセを反映できます。
                </p>
                <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot />「呆れ」は主にこの辞書で検出されます。「まぁ」「えー」などの感動詞を登録すると検出されやすくなります</li>
                </ul>
              </Section>

              <Section title="感情分析モデル">
                <ul className="list-none space-y-1" style={{ paddingLeft: "1em" }}>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>ローカル（BERT）:</strong> オフラインで動作。WRIME v2 モデル</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot /><strong style={{ color: "var(--text-secondary)" }}>LLM:</strong> API キーが必要。より高精度な分析</li>
                  <li style={{ color: "var(--text-muted)" }}><Dot />モデルの選択と API キーの入力は <strong style={{ color: "var(--text-secondary)" }}>設定 → 感情分析</strong> から</li>
                </ul>
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
