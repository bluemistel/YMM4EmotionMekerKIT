# サードパーティ ライセンス / 帰属表示

本ソフトウェア **YMM4 EmotionMaker KIT** 本体は **AGPL-3.0-or-later** で配布しています（[LICENSE](LICENSE)）。
本体に同梱・依存する第三者ソフトウェア、および利用する感情分析モデル・データセットのライセンスと帰属を以下に示します。各コンポーネントはそれぞれのライセンスのもとで提供されます。

最終更新: 2026/06/15（v1.0.8）

---

## 感情分析モデル / データセット

| 名称 | ライセンス | 区分 | 備考・帰属 |
|------|-----------|------|-----------|
| patrickramos/bert-base-japanese-v2-wrime-fine-tune | **CC BY-SA 3.0** | 実行時ダウンロード（本体未同梱） | 感情分析に使用。初回分析時に Hugging Face から各端末へ取得します。 https://huggingface.co/patrickramos/bert-base-japanese-v2-wrime-fine-tune |
| WRIME（感情強度付き SNS コーパス） | **CC BY-NC-ND 4.0** | 上記モデルの学習元データセット | 非営利・改変不可。本ソフトウェアは無償で提供しています。 https://github.com/ids-cv/wrime |
| cl-tohoku/bert-base-japanese-v2（基盤モデル） | CC BY-SA 3.0 | 上記モデルの基盤 | 東北大学 乾・鈴木研究室。 https://huggingface.co/cl-tohoku/bert-base-japanese-v2 |

注: 感情分析モデルの重みは本体インストーラには同梱しておらず、利用者の端末が実行時に取得します（再配布は行っていません）。モデルは CC BY-SA 3.0、学習元の WRIME は CC BY-NC-ND 4.0 です。本ソフトウェアは無償公開であり、これらの帰属表示を行います。

---

## Python ライブラリ（配布版インストーラに同梱）

| ライブラリ | ライセンス |
|-----------|-----------|
| PyTorch (torch) | BSD-3-Clause |
| Transformers | Apache-2.0 |
| Tokenizers | Apache-2.0 |
| safetensors | Apache-2.0 |
| huggingface_hub | Apache-2.0 |
| FastAPI | MIT |
| Starlette | BSD-3-Clause |
| Uvicorn | BSD-3-Clause |
| Pydantic | MIT |
| PyYAML | MIT |
| psd-tools | MIT |
| fugashi | MIT |
| unidic-lite | BSD-3-Clause（同梱辞書 UniDic は GPL/LGPL/BSD のトリプルライセンス。本ソフトウェアは BSD 条項に基づき利用） |
| regex | Apache-2.0 / PSF |
| anyio | MIT |
| h11 | MIT |
| click | BSD-3-Clause |
| Anthropic Python SDK（任意・LLM 分析時） | MIT |
| OpenAI Python SDK（任意・LLM 分析時） | Apache-2.0 |

---

## フロントエンド / デスクトップ

| ソフトウェア | ライセンス |
|-------------|-----------|
| Next.js | MIT |
| React / React DOM | MIT |
| Electron | MIT |
| Tailwind CSS | MIT |
| TypeScript | Apache-2.0 |

---

## フォント

| フォント | ライセンス | 区分 |
|---------|-----------|------|
| Zen Kaku Gothic New | SIL Open Font License 1.1 | UI 表示（Google Fonts 経由・実体未同梱） |
| JetBrains Mono | SIL Open Font License 1.1 | UI 表示（Google Fonts 経由・実体未同梱） |

---

## 注記

- 上記は主要コンポーネントの一覧です。各ライブラリが依存する推移的依存も、それぞれのライセンス（多くは MIT / BSD / Apache-2.0）のもとで提供されます。
- 各ライセンスの全文は、それぞれの配布元、または配布版インストーラに同梱の各ライセンスファイルをご確認ください。
- バージョンごとの正確な構成は、リリース時に生成する SBOM（`pip-licenses` / `license-checker` 等）で確認できます。
