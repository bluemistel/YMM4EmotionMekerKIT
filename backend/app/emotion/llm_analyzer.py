# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import json
import logging

from .base import EmotionAnalyzer, EmotionResult, EMOTION_LABELS

logger = logging.getLogger(__name__)

# LLM API の1リクエストあたりタイムアウト（秒）と再試行回数。
# 未設定だと SDK 既定（約10分）になり、レート制限/ネットワーク不調で
# 「分析が終わらない」ように見えるため、明示的に短く区切る。
LLM_TIMEOUT_SECONDS = 60.0
LLM_MAX_RETRIES = 2

SYSTEM_PROMPT = """\
あなたは日本語テキストの感情分析エンジンです。
与えられた台詞テキストから以下の9つの感情の強度を0.0～1.0のスコアで判定してください。

- joy (喜): 嬉しさ、楽しさ、喜び
- anger (怒): 怒り、苛立ち、不満
- sadness (哀): 悲しみ、寂しさ、失望
- happiness (楽): 安心、満足、穏やかな幸福感
- surprise (驚き): 驚き、意外性
- embarrassment (照れ): 照れ、恥ずかしさ、てれくささ
- disgust (嫌悪): 嫌悪感、不快、うんざり
- fear (恐れ): 恐怖、不安、おびえ
- exasperation (呆れ): 相手の発言に対する あきれ・脱力・冷めた反応・ツッコミ

短文・口語・感嘆符の多い台詞が入力されます。
文脈（直前の会話）が与えられた場合は会話の流れを考慮し、相手のフリに対する
リアクションとしての感情も読み取ってください。ただし判定対象は必ず
【台詞】に示された「最後の話者の発話」のみで、文脈中の他の発話は判定しません。

必ず以下のJSON形式のみで回答してください（説明文は不要）:
{"joy": 0.0, "anger": 0.0, "sadness": 0.0, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0}
"""


class LlmEmotionAnalyzer(EmotionAnalyzer):
    def __init__(self, provider: str = "claude", api_key: str | None = None, model: str | None = None,
                 reasoning_effort: str | None = None):
        self.provider = provider
        self.api_key = api_key
        self._client = None
        # OpenAI 推論モデル（GPT-5 / o 系）の推論の深さ。gpt-4o 系では無視。
        self.reasoning_effort = (reasoning_effort or "").strip() or None

        # 既定は軽量・現役モデル（設定が空のときの保険。通常は設定値が渡る）。
        if provider == "claude":
            self.model = model or "claude-haiku-4-5-20251001"
        else:
            self.model = model or "gpt-4o-mini"

    def _is_openai_reasoning_model(self) -> bool:
        """OpenAI の推論モデル（GPT-5 / o1 / o3 / o4 系）かを名前から判定する。

        推論モデルは Chat Completions の引数仕様が異なる（max_completion_tokens 必須・
        temperature 非対応・reasoning_effort 対応・推論トークンを消費）。
        """
        m = (self.model or "").lower()
        return m.startswith("gpt-5") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4")

    def _get_claude_client(self):
        if self._client is None:
            if not self.api_key:
                raise RuntimeError(
                    "Claude の API キーが未設定です。設定 ＞ 感情分析 で API キーを入力してください。"
                )
            try:
                import anthropic
            except ImportError as e:
                raise RuntimeError(
                    "Claude 連携ライブラリ（anthropic）が見つかりません。LLM 感情分析を使うには "
                    "`pip install anthropic` を実行してください。"
                ) from e
            self._client = anthropic.Anthropic(
                api_key=self.api_key,
                timeout=LLM_TIMEOUT_SECONDS,
                max_retries=LLM_MAX_RETRIES,
            )
        return self._client

    def _get_openai_client(self):
        if self._client is None:
            if not self.api_key:
                raise RuntimeError(
                    "OpenAI の API キーが未設定です。設定 ＞ 感情分析 で API キーを入力してください。"
                )
            try:
                import openai
            except ImportError as e:
                raise RuntimeError(
                    "OpenAI 連携ライブラリ（openai）が見つかりません。LLM 感情分析を使うには "
                    "`pip install openai` を実行してください。"
                ) from e
            self._client = openai.OpenAI(
                api_key=self.api_key,
                timeout=LLM_TIMEOUT_SECONDS,
                max_retries=LLM_MAX_RETRIES,
            )
        return self._client

    def _build_user_message(self, text: str, context: list[str] | None = None) -> str:
        parts = []
        if context:
            parts.append("【文脈】\n" + "\n".join(context[-3:]))
        parts.append(f"【台詞】\n{text}")
        return "\n\n".join(parts)

    def _parse_response(self, content: str) -> EmotionResult:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start == -1 or end == 0:
            logger.warning("Failed to parse LLM response: %s", content)
            return EmotionResult()

        data = json.loads(content[start:end])
        return EmotionResult(**{k: float(data.get(k, 0.0)) for k in EMOTION_LABELS})

    def _friendly_error(self, e: Exception) -> str:
        """API 例外を、原因の分かる日本語メッセージに変換する。"""
        name = type(e).__name__
        msg = str(e)
        low = msg.lower()
        prov = "Claude" if self.provider == "claude" else "OpenAI"
        if "ratelimit" in name.lower() or "429" in msg:
            return (f"{prov} のレート制限に達しました。台詞数が多いと逐次リクエストで上限に当たりやすく、"
                    f"分析が止まって見えることがあります。少し時間をおく／API プランのレート上限を見直す／"
                    f"OpenAI を使う、をお試しください。（{name}）")
        if "timeout" in name.lower() or "timed out" in low or "apiconnection" in name.lower():
            return (f"{prov} API への接続がタイムアウトしました（応答遅延・ネットワーク不調・レート制限の可能性）。"
                    f"（{name}）")
        if "authentication" in name.lower() or "401" in msg or "permission" in name.lower():
            return f"{prov} の API キーが無効、または権限がありません。設定でキーをご確認ください。（{name}）"
        if "notfound" in name.lower() or "404" in msg:
            return (f"{prov} のモデルID『{self.model}』が見つからない／利用できません。"
                    f"設定 ＞ 感情分析 の「使用モデル」で別モデルをお試しください。（{name}）")
        return f"{prov} API 呼び出しに失敗しました（{name}）: {msg}"

    def analyze(self, text: str, context: list[str] | None = None) -> EmotionResult:
        user_msg = self._build_user_message(text, context)

        if self.provider == "claude":
            client = self._get_claude_client()
            try:
                response = client.messages.create(
                    model=self.model,
                    max_tokens=200,
                    temperature=0,
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": user_msg}],
                )
            except Exception as e:
                raise RuntimeError(self._friendly_error(e)) from e
            content = response.content[0].text
        else:
            client = self._get_openai_client()
            params: dict = {
                "model": self.model,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
            }
            if self._is_openai_reasoning_model():
                # 推論モデル: 推論トークンも消費するため出力上限は大きめ、temperature 非対応。
                params["max_completion_tokens"] = 4096
                if self.reasoning_effort:
                    params["reasoning_effort"] = self.reasoning_effort
            else:
                # 従来モデル(gpt-4o 系): 既存どおり max_tokens + temperature。
                params["max_tokens"] = 256
                params["temperature"] = 0
            try:
                response = client.chat.completions.create(**params)
            except Exception as e:
                raise RuntimeError(self._friendly_error(e)) from e
            content = response.choices[0].message.content

        return self._parse_response(content)
