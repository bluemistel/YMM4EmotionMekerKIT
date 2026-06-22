# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import json
import logging

from .base import EmotionAnalyzer, EmotionResult, EMOTION_LABELS

logger = logging.getLogger(__name__)

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
    def __init__(self, provider: str = "claude", api_key: str | None = None, model: str | None = None):
        self.provider = provider
        self.api_key = api_key
        self._client = None

        if provider == "claude":
            self.model = model or "claude-sonnet-4-20250514"
        else:
            self.model = model or "gpt-4o-mini"

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
            self._client = anthropic.Anthropic(api_key=self.api_key)
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
            self._client = openai.OpenAI(api_key=self.api_key)
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

    def analyze(self, text: str, context: list[str] | None = None) -> EmotionResult:
        user_msg = self._build_user_message(text, context)

        if self.provider == "claude":
            client = self._get_claude_client()
            response = client.messages.create(
                model=self.model,
                max_tokens=200,
                temperature=0,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            content = response.content[0].text
        else:
            client = self._get_openai_client()
            response = client.chat.completions.create(
                model=self.model,
                max_tokens=200,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
            )
            content = response.choices[0].message.content

        return self._parse_response(content)
