"use client";
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";

type Section = "overview" | "analyze" | "labeling" | "persona" | "lexicon" | "trouble";

const NAV: { key: Section; label: string }[] = [
  { key: "overview", label: "概要" },
  { key: "analyze", label: "プロジェクト解析" },
  { key: "labeling", label: "ラベリング（学習データ用）" },
  { key: "persona", label: "キャラの性格マップ" },
  { key: "lexicon", label: "感情辞書・モデル" },
  { key: "trouble", label: "トラブルシューティング" },
];

export default function HelpModal() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("overview");

  return (
    <>
      <button onClick={() => { setSection("overview"); setOpen(true); }} className="btn-ghost" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        使い方
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "#000000b0", backdropFilter: "blur(8px)" }}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="panel w-full max-w-4xl max-h-[85vh] overflow-hidden p-0 animate-fadeIn flex" style={{ background: "var(--bg-panel)" }}>
            {/* 左ナビ */}
            <div style={{ width: "190px", flexShrink: 0, borderRight: "1px solid var(--border-dim)", background: "var(--bg-surface)", padding: "20px 10px" }}>
              <h2 className="display-text" style={{ fontFamily: "var(--font-display)", fontSize: "1.0rem", fontWeight: 700, color: "var(--accent)", padding: "0 8px", marginBottom: "14px" }}>
                使い方
              </h2>
              <nav className="space-y-1">
                {NAV.map((item) => {
                  const on = section === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSection(item.key)}
                      className="w-full text-left transition-colors"
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: on ? 700 : 500,
                        padding: "7px 10px",
                        borderRadius: "6px",
                        background: on ? "var(--accent)" : "transparent",
                        color: on ? "#fff" : "var(--text-muted)",
                        cursor: "pointer",
                        lineHeight: 1.3,
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* 右コンテンツ */}
            <div className="flex-1 overflow-y-auto p-7" style={{ color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: "1.8" }}>
              <div className="flex justify-end" style={{ marginBottom: "-8px" }}>
                <button onClick={() => setOpen(false)} className="btn-ghost" style={{ fontSize: "1.25rem", color: "var(--text-muted)" }}>
                  &times;
                </button>
              </div>

              {section === "overview" && (
                <div className="space-y-6">
                  <Section title="このアプリについて">
                    <p>
                      YMM4 EmotionMaker KIT は、ゆっくりムービーメーカー4のプロジェクトに含まれる台詞テキストを
                      AI で感情分析し、キャラクターの表情（動く立ち絵のプリセット）を自動配置するツールです。
                    </p>
                  </Section>
                  <Section title="2つの使い方">
                    <ul className="list-none space-y-2" style={{ paddingLeft: "1em" }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>プロジェクト解析:</strong> .ymmp を読み込み、感情分析して表情を自動配置・書き出します（通常の使い方）。</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>ラベリング（学習データ用）:</strong> 過去プロジェクトの台詞に正解感情をラベル付けして蓄積し、分析精度をあなた好みに育てます。</li>
                    </ul>
                    <Tip>初期画面の「学習データ用として読み込み」トグルで、読み込んだ .ymmp をどちらのモードで開くか切り替えます。</Tip>
                  </Section>
                </div>
              )}

              {section === "analyze" && (
                <div className="space-y-6">
                  <Section title="Step 1: プロジェクトを読み込む">
                    <p>
                      初期画面に .ymmp をドラッグ＆ドロップ、「ファイルを選択」、またはパス入力で読み込みます
                      （「学習データ用として読み込み」トグルは OFF のまま）。
                    </p>
                    <Tip>YMM4 を閉じた状態で操作することをおすすめします。</Tip>
                  </Section>

                  <Section title="Step 2: 分析の最適化ウィザード（自動表示）">
                    <p>読み込むと、動画の作りに合わせて設定を調整する設問が自動で開きます。答えて「この設定で分析開始」で感情分析まで自動実行されます。</p>
                    <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>掛け合い重視:</strong> リアクション感情を重視（文脈ターン＋話者名で区別）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情表現のメリハリ:</strong> 振れ幅の強さ（reader ブレンド）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>会話のテンポと間:</strong> 無音をどの長さで場面の区切りにするか（文脈ギャップ）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情の余韻・流れ:</strong> 余韻を残す／急変・徐々に専用表情（後処理）</li>
                      <li><Dot />「スキップ」で現在設定のまま分析。以降は <strong style={{ color: "var(--text-secondary)" }}>設定 → 感情分析</strong> で手動調整可</li>
                    </ul>
                  </Section>

                  <Section title="Step 3: キャラクター設定 / 感情マッピング">
                    <p>中央カラムのアイコン（色＋頭文字）でキャラを選択。9つの感情（喜・怒・哀・楽・驚き・照れ・嫌悪・恐れ・呆れ）に表情プリセットを割り当てます。</p>
                    <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                      <li><Dot />単独感情は <strong style={{ color: "var(--text-secondary)" }}>弱／中／強</strong> の強度別プリセットも任意設定（未設定は中）</li>
                      <li><Dot />複合感情（例：喜び＋照れ）、急変・徐々の勾配プリセットも設定可能</li>
                      <li><Dot />preset.ini が見つからない場合は手動でパス指定。設定は自動保存</li>
                    </ul>
                  </Section>

                  <Section title="Step 4: 結果確認と個別調整">
                    <p>右カラムに分析結果と感情バッジが並びます。台詞を選ぶと左に大きなプレビュー、中央の「個別設定」タブで上書きできます。</p>
                    <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情で指定:</strong> 感情をクリック順に最大3つ（複合）。第1感情のみのとき強度（弱/中/強）も指定可</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>プリセットで指定:</strong> プリセットを直接選択</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>パーツ個別変更:</strong> 目・口などを個別に差し替え（変更すると [個別] マーク）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>前回の表情を保つ:</strong> 新しい表情を作らず直前の表情を継続</li>
                    </ul>
                  </Section>

                  <Section title="Step 5: 書き出し">
                    <p>ヘッダーの「書き出し」から出力先を確認し、実行で表情アイテムをプロジェクトに書き出します。</p>
                    <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                      <li><Dot />既定で「_emotion」を付けて保存。バックアップで元ファイルを保護</li>
                      <li><Dot />表情アイテムは同キャラの立ち絵が表示されている区間に合わせて配置・延長されます</li>
                      <li><Dot />既存の表情アイテムは書き出し対象キャラ分を整理し、重複適用を防ぎます</li>
                    </ul>
                  </Section>
                </div>
              )}

              {section === "labeling" && (
                <div className="space-y-6">
                  <Section title="ラベリングとは（個人適応学習）">
                    <p>
                      過去プロジェクトの台詞に「正解の主感情」をラベル付けして蓄積すると、その傾向を学習した
                      個人モデルが作られ、<strong style={{ color: "var(--text-secondary)" }}>以後の分析があなたのラベルの付け方に適応</strong>します。
                      使い続けるほど精度が育つ仕組みです（蓄積データはアプリ内に保存され、プロジェクトを跨いで貯まります）。
                    </p>
                  </Section>

                  <Section title="手順">
                    <ul className="list-none space-y-1.5" style={{ paddingLeft: "1em" }}>
                      <li><Dot />初期画面で <strong style={{ color: "var(--text-secondary)" }}>「学習データ用として読み込み」トグルを ON</strong> にする</li>
                      <li><Dot />.ymmp を読み込む（D&D／ファイル選択／パス入力）→ 感情分析せずラベリング画面が開く</li>
                      <li><Dot />各台詞に最も近い<strong style={{ color: "var(--text-secondary)" }}>主感情を1つ</strong>付ける（キーボード: <strong>1–9</strong>=感情 / <strong>0</strong>=中立 / <strong>↑↓</strong>=移動 / <strong>Enter</strong>=次へ）</li>
                      <li><Dot />「ラベルを保存」→「学習を再構築」で個人モデルを更新</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>設定 → 感情分析 →「個人学習を使う」</strong>を ON にし、強度を調整</li>
                    </ul>
                  </Section>

                  <Section title="ポイント">
                    <ul className="list-none space-y-1" style={{ paddingLeft: "1em" }}>
                      <li><Dot />ローカル（BERT）モデル使用時のみ有効です</li>
                      <li><Dot />各感情に数件以上あると効き始め、件数が増えるほど安定します（強度は自動でも調整されます）</li>
                      <li><Dot />複合・強度はラベリング対象外。感情マッピングや感情辞書、性格マップで補います</li>
                    </ul>
                  </Section>
                </div>
              )}

              {section === "persona" && (
                <div className="space-y-6">
                  <Section title="キャラの性格マップ">
                    <p>
                      キャラを <strong style={{ color: "var(--text-secondary)" }}>感情価×覚醒度</strong> の2軸マップに配置すると、
                      その方向の感情が出やすくなります（横＝ネガ⇔ポジ／縦＝落ち着き⇔ハイテンション）。
                      「関西弁でツッコミ役」のようなキャラ像を方向付ける、創作寄りの機能です。
                    </p>
                  </Section>
                  <Section title="使い方">
                    <ul className="list-none space-y-1" style={{ paddingLeft: "1em" }}>
                      <li><Dot />中央カラムの「キャラの性格マップ」でキャラのアイコンをドラッグして配置</li>
                      <li><Dot />選択中キャラの「強さ」スライダーで反映度を調整（0＝無効）</li>
                      <li><Dot />分析へのソフトな事前分布として効きます（本文の内容を無視はしません）</li>
                      <li><Dot />設定は感情マッピングと同様にアプリ共通設定として保存・復元されます</li>
                    </ul>
                  </Section>
                </div>
              )}

              {section === "lexicon" && (
                <div className="space-y-6">
                  <Section title="感情辞書（語句→感情の補正）">
                    <p>
                      台詞に特定の語句が含まれるとき、指定感情を <strong style={{ color: "var(--text-secondary)" }}>強める（boost＝加算）</strong>／
                      <strong style={{ color: "var(--text-secondary)" }}>固定する（set）</strong>ルールです（<strong style={{ color: "var(--text-secondary)" }}>設定 → 感情辞書</strong>）。
                    </p>
                    <ul className="list-none mt-2 space-y-1" style={{ paddingLeft: "1em" }}>
                      <li><Dot />「呆れ」は主にこの辞書で検出されます。「まぁ」「えー」などの感動詞を登録すると検出されやすくなります</li>
                    </ul>
                  </Section>
                  <Section title="感情分析モデル">
                    <ul className="list-none space-y-1" style={{ paddingLeft: "1em" }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>ローカル（BERT）:</strong> オフラインで動作。WRIME v2 モデル（個人学習に対応）</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>LLM:</strong> API キーが必要。より高精度な分析</li>
                      <li><Dot />選択と API キー入力は <strong style={{ color: "var(--text-secondary)" }}>設定 → 感情分析</strong> から</li>
                    </ul>
                  </Section>
                </div>
              )}

              {section === "trouble" && (
                <div className="space-y-6">
                  <Section title="トラブルシューティング">
                    <ul className="list-none space-y-2" style={{ paddingLeft: "1em" }}>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>プリセットが読み込めない：</strong> preset.ini のパスを確認</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>感情分析が遅い：</strong> 初回はモデルDL（約500MB）が必要</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>表情が期待と違う：</strong> 個別設定で手動修正、または個人学習・性格マップ・感情辞書で調整</li>
                      <li><Dot /><strong style={{ color: "var(--text-secondary)" }}>個人学習が効かない：</strong> ローカルモデルか、設定で「個人学習を使う」が ON か、学習を再構築済みかを確認</li>
                    </ul>
                  </Section>
                </div>
              )}
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
