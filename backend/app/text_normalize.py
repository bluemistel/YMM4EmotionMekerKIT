from __future__ import annotations

"""YMM4 字幕テキストの正規化。

YMM4 の台詞には制御タグ（全て `< >` 区切り）が混入しうる。感情分析・埋め込み・
感情辞書の一致・学習ラベルはいずれも「実際に話す語」を対象にしたいので、これらの
タグを取り除いてクリーンなテキストに正規化する。

参照: https://manjubox.net/ymm4/faq/editing/text_control_tags/
  色 <#rrggbb>/<#>、サイズ <sN>/<s>、フォント <@font>/<@>、位置 <pX,Y>/<ppX,Y>、
  回転 <rotN>/<rot>、表示速度 <rN>/<r>、ウェイト <wN>、クリア <c>/<cN>、
  字間 <lsN>/<ls>、ルビ <rb親文字,ルビ[,offset]>。

ルビは「親文字（実際に話す語）」を含むため、単純除去ではなく親文字を残す。
"""

import re

# ルビ: <rb親文字,ルビ[,オフセット]> → 親文字（最初のカンマまで）を残す。
# 親文字にカンマや '>' は含まれない前提（YMM4 の仕様）。
_RUBY_RE = re.compile(r"<rb([^,>]*),[^>]*>", re.IGNORECASE)

# 残りの制御タグ全般（<...>）。ルビ処理後に適用する。
_TAG_RE = re.compile(r"<[^>]*>")

# 連続する空白の圧縮用。
_WS_RE = re.compile(r"[ \t　]{2,}")


def normalize_serif(text: str | None) -> str:
    """YMM4 制御タグを除去したクリーンな台詞テキストを返す。

    1. ルビ `<rb親文字,ルビ>` は親文字に置換（読みは破棄）。
    2. エスケープ `<<` は本来 `<` の表示なので復元（タグ除去より先に保護）。
    3. 残りの `<...>` タグを除去。
    4. 余分な空白を圧縮して trim。
    """
    if not text:
        return ""
    s = str(text)
    # ルビ（親文字を残す）。
    s = _RUBY_RE.sub(r"\1", s)
    # `<<` を一時退避してからタグ除去 → 復元（リテラルの '<' を守る）。
    sentinel = "\x00LT\x00"
    s = s.replace("<<", sentinel)
    s = _TAG_RE.sub("", s)
    s = s.replace(sentinel, "<")
    # 空白整理（改行は保持）。
    s = _WS_RE.sub(" ", s)
    return s.strip()
