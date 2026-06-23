# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from ..ymmp_parser import VoiceItem
from .base import EmotionAnalyzer, EmotionResult, EMOTION_LABELS

logger = logging.getLogger(__name__)

_EMOTION_DESCRIPTIONS = {
    "joy": ("喜", "嬉しさ、楽しさ、喜び"),
    "anger": ("怒", "怒り、苛立ち、不満"),
    "sadness": ("哀", "悲しみ、寂しさ、失望"),
    "happiness": ("楽", "安心、満足、穏やかな幸福感"),
    "surprise": ("驚き", "驚き、意外性"),
    "embarrassment": ("照れ", "照れ、恥ずかしさ、てれくささ"),
    "disgust": ("嫌悪", "嫌悪感、不快、うんざり"),
    "fear": ("恐れ", "恐怖、不安、おびえ"),
    "exasperation": ("呆れ", "相手の発言に対するあきれ・脱力・冷めた反応・ツッコミ"),
}

_FEW_SHOT_BLOCK = """\
【判定例】

例1:
会話:
1. 田中: おはよう！今日もいい天気だね。
2. 山田: うん、ほんと気持ちいいね。
感情スコア:
[
  {"joy": 0.7, "anger": 0.0, "sadness": 0.0, "happiness": 0.5, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0},
  {"joy": 0.5, "anger": 0.0, "sadness": 0.0, "happiness": 0.6, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0}
]

例2:
会話:
1. 田中: ねえ、私のお菓子食べたでしょ？
2. 山田: えっ、食べてないよ！
3. 田中: ほんと？箱が空になってるんだけど。
感情スコア:
[
  {"joy": 0.0, "anger": 0.4, "sadness": 0.1, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.2, "fear": 0.0, "exasperation": 0.3},
  {"joy": 0.0, "anger": 0.0, "sadness": 0.0, "happiness": 0.0, "surprise": 0.7, "embarrassment": 0.2, "disgust": 0.0, "fear": 0.1, "exasperation": 0.0},
  {"joy": 0.0, "anger": 0.5, "sadness": 0.2, "happiness": 0.0, "surprise": 0.1, "embarrassment": 0.0, "disgust": 0.3, "fear": 0.0, "exasperation": 0.6}
]

例3:
会話:
1. 田中: 待って、まさかそんなことあるわけないじゃん。
2. 山田: いや、本当なんだって。信じてよ。
感情スコア:
[
  {"joy": 0.0, "anger": 0.2, "sadness": 0.0, "happiness": 0.0, "surprise": 0.5, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.1, "exasperation": 0.6},
  {"joy": 0.1, "anger": 0.3, "sadness": 0.2, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.4}
]

例4:
会話:
1. 田中: おめでとう！合格したんだって！
2. 山田: うわっ、ほんと！？やったあ！
感情スコア:
[
  {"joy": 0.8, "anger": 0.0, "sadness": 0.0, "happiness": 0.4, "surprise": 0.1, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0},
  {"joy": 0.9, "anger": 0.0, "sadness": 0.0, "happiness": 0.3, "surprise": 0.8, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0}
]

例5:
会話:
1. 田中: 暗い部屋に閉じ込められたんだ...
2. 山田: 大丈夫？出口を探そう。
感情スコア:
[
  {"joy": 0.0, "anger": 0.0, "sadness": 0.5, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.8, "exasperation": 0.0},
  {"joy": 0.1, "anger": 0.0, "sadness": 0.2, "happiness": 0.3, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.2, "exasperation": 0.0}
]

例6:
会話:
1. 田中: ずっと前から伝えたかったんだけど、私、山田のことが……
2. 山田: えっ……？
3. 田中: 好き、です。付き合ってください。
4. 山田: ……うん。私も。
感情スコア:
[
  {"joy": 0.3, "anger": 0.0, "sadness": 0.2, "happiness": 0.2, "surprise": 0.0, "embarrassment": 0.8, "disgust": 0.0, "fear": 0.4, "exasperation": 0.0},
  {"joy": 0.1, "anger": 0.0, "sadness": 0.0, "happiness": 0.0, "surprise": 0.9, "embarrassment": 0.3, "disgust": 0.0, "fear": 0.1, "exasperation": 0.0},
  {"joy": 0.7, "anger": 0.0, "sadness": 0.0, "happiness": 0.5, "surprise": 0.2, "embarrassment": 0.6, "disgust": 0.0, "fear": 0.3, "exasperation": 0.0},
  {"joy": 0.8, "anger": 0.0, "sadness": 0.0, "happiness": 0.7, "surprise": 0.1, "embarrassment": 0.5, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0}
]

例7:
会話:
1. A: また遅刻したんですか？
2. B: すみません、寝坊しまして……
3. A: 何回目ですか？全く信じられません。
4. B: 本当に申し訳ありません。次は絶対に……
5. A: はいはい、言い訳はいいです。今日のところは帰ってください。
感情スコア:
[
  {"joy": 0.0, "anger": 0.6, "sadness": 0.1, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.2, "fear": 0.0, "exasperation": 0.4},
  {"joy": 0.0, "anger": 0.0, "sadness": 0.3, "happiness": 0.0, "surprise": 0.1, "embarrassment": 0.6, "disgust": 0.0, "fear": 0.3, "exasperation": 0.0},
  {"joy": 0.0, "anger": 0.8, "sadness": 0.2, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.4, "fear": 0.0, "exasperation": 0.7},
  {"joy": 0.0, "anger": 0.0, "sadness": 0.5, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.7, "disgust": 0.0, "fear": 0.4, "exasperation": 0.0},
  {"joy": 0.0, "anger": 0.5, "sadness": 0.0, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.5, "fear": 0.0, "exasperation": 0.8}
]

例8:
会話:
1. 子供: ママ、今日のご飯なに？
2. 母: お母さん特製のカレーよ。
3. 子供: やったー！カレー大好き！
4. 母: たくさん食べてね。
感情スコア:
[
  {"joy": 0.4, "anger": 0.0, "sadness": 0.0, "happiness": 0.3, "surprise": 0.1, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0},
  {"joy": 0.5, "anger": 0.0, "sadness": 0.0, "happiness": 0.6, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0},
  {"joy": 0.9, "anger": 0.0, "sadness": 0.0, "happiness": 0.5, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0},
  {"joy": 0.6, "anger": 0.0, "sadness": 0.0, "happiness": 0.7, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0}
]
"""

_CHUNK_SIZE = 20
_CHUNK_OVERLAP = 2


class LlmEmotionAnalyzer(EmotionAnalyzer):
    def __init__(self, provider: str = "claude", api_key: str | None = None, model: str | None = None):
        self.provider = provider
        self.api_key = api_key
        self._client = None

        if provider == "claude":
            self.model = model or "claude-sonnet-4-6"
        elif provider == "deepseek":
            self.model = model or "deepseek-v4-flash"
        else:
            self.model = model or "gpt-5.4-mini"

    # ------------------------------------------------------------------
    # Client helpers
    # ------------------------------------------------------------------
    def _get_claude_client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=self.api_key)
        return self._client

    def _get_openai_client(self, base_url: str | None = None):
        if self._client is None or getattr(self, "_client_base_url", None) != base_url:
            import openai
            self._client = openai.OpenAI(api_key=self.api_key, base_url=base_url)
            self._client_base_url = base_url
        return self._client

    # ------------------------------------------------------------------
    # Prompt / schema builders
    # ------------------------------------------------------------------
    def _base_instruction(self, target_emotions: list[str] | None = None) -> str:
        emotions = target_emotions or EMOTION_LABELS
        lines = [
            "あなたは日本語台詞の感情分析エンジンです。",
            f"与えられた台詞群から、以下の{len(emotions)}つの感情の強度を0.0～1.0のスコアで判定してください。",
            "",
        ]
        for e in emotions:
            ja, desc = _EMOTION_DESCRIPTIONS[e]
            lines.append(f"- {e} ({ja}): {desc}")
        example_item = json.dumps({e: 0.0 for e in emotions}, ensure_ascii=False)
        example = f'{{"scores": [{example_item}, ...]}}'
        lines.extend([
            "",
            "短文・口語・感嘆符の多い台詞が入力されます。",
            "会話の流れを考慮し、直前の発話に対するリアクションとしての感情も読み取ってください。",
            "判定対象は【会話】に示された各話者の発話すべてです。",
            "",
            "必ず以下のJSON形式のみで回答してください（説明文は不要）:",
            example,
            "",
            "scores配列の各要素は、入力された台詞1つずつに対応し、入力順と同じ順序で並べてください。",
        ])
        return "\n".join(lines)

    def _persona_text(self, personas: dict[str, dict] | None) -> str:
        if not personas:
            return ""
        active = [
            (name, p)
            for name, p in personas.items()
            if p.get("strength", 0) > 0
        ]
        if not active:
            return ""
        lines = ["", "【キャラクター事前性情報】", ""]
        for name, p in active:
            valence = float(p.get("valence", 0.0))
            arousal = float(p.get("arousal", 0.0))
            strength = float(p.get("strength", 0.0))
            lines.append(
                f"- {name}: 感情価={valence:.2f}（ネガ⇔ポジ）、"
                f"覚醒度={arousal:.2f}（落ち着き⇔ハイテンション）、強度={strength:.2f}"
            )
        lines.extend([
            "",
            "上記の性格傾向を加味してスコアを調整してください（strengthが大きいほど影響を強めます）。",
        ])
        return "\n".join(lines)

    def _build_system_prompt(self, target_emotions: list[str] | None = None, personas: dict[str, dict] | None = None) -> str:
        return self._base_instruction(target_emotions) + _FEW_SHOT_BLOCK + self._persona_text(personas)

    def _build_claude_system(self, target_emotions: list[str] | None = None, personas: dict[str, dict] | None = None) -> list[dict]:
        """Anthropic prompt caching: short instruction first, long few-shot + persona last with cache_control."""
        return [
            {
                "type": "text",
                "text": self._base_instruction(target_emotions),
            },
            {
                "type": "text",
                "text": _FEW_SHOT_BLOCK + self._persona_text(personas),
                "cache_control": {"type": "ephemeral"},
            },
        ]

    def _build_json_schema(self, target_emotions: list[str] | None = None) -> dict:
        emotions = target_emotions or EMOTION_LABELS
        item_schema = {
            "type": "object",
            "properties": {
                e: {
                    "type": "number",
                    "description": f"{_EMOTION_DESCRIPTIONS[e][0]}の強度（0.0〜1.0）",
                }
                for e in emotions
            },
            "required": emotions,
            "additionalProperties": False,
        }
        return {
            "name": "emotion_scores",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "scores": {
                        "type": "array",
                        "items": item_schema,
                    }
                },
                "required": ["scores"],
                "additionalProperties": False,
            },
        }

    def _build_group_user_message(self, voices, target_emotions: list[str] | None = None) -> str:
        emotions = target_emotions or EMOTION_LABELS
        lines = ["【会話】"]
        for i, v in enumerate(voices, 1):
            speaker = v.character_name or "話者"
            lines.append(f"{i}. {speaker}: {v.serif}")
        example_item = json.dumps({e: 0.0 for e in emotions}, ensure_ascii=False)
        example = f'{{"scores": [{example_item}, ...]}}'
        lines.extend([
            "",
            "上記の各台詞について、感情スコアを入力順と同じ順序でJSON配列として返してください。",
            example,
        ])
        return "\n".join(lines)

    def _build_user_message(self, text: str, context: list[str] | None = None) -> str:
        parts = []
        if context:
            parts.append("【文脈】\n" + "\n".join(context[-3:]))
        parts.append(f"【台詞】\n{text}")
        parts.append("")
        parts.append("上記の台詞について、感情スコアをJSON形式で返してください。")
        parts.append('{"joy": 0.0, "anger": 0.0, "sadness": 0.0, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0}')
        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    # API calls
    # ------------------------------------------------------------------
    def _call_claude(self, system_blocks: list[dict], user_msg: str, max_tokens: int) -> str:
        client = self._get_claude_client()
        response = client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=0,
            system=system_blocks,
            messages=[{"role": "user", "content": user_msg}],
        )
        return response.content[0].text

    def _call_openai(
        self,
        system_prompt: str,
        user_msg: str,
        max_tokens: int,
        use_json_schema: bool,
        target_emotions: list[str] | None = None,
    ) -> str:
        client = self._get_openai_client()
        response_format = (
            {"type": "json_schema", "json_schema": self._build_json_schema(target_emotions)}
            if use_json_schema
            else {"type": "json_object"}
        )
        response = client.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=0,
            response_format=response_format,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
        )
        return response.choices[0].message.content or ""

    def _call_deepseek(self, system_prompt: str, user_msg: str, max_tokens: int) -> str:
        client = self._get_openai_client(base_url="https://api.deepseek.com")
        # DeepSeek V4 defaults to thinking mode, which consumes max_tokens with
        # reasoning_content and can truncate the actual JSON output. Disable it
        # for deterministic, token-efficient emotion scoring.
        response = client.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            extra_body={"thinking": {"type": "disabled"}},
        )
        return response.choices[0].message.content or ""

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_json(text: str):
        """Extract the first JSON object/array from a string."""
        text = text.strip()
        if not text:
            raise ValueError("Empty LLM response")

        # Markdown fenced code block
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fence:
            text = fence.group(1).strip()

        # Try to find the first JSON object/array. Arrays first so raw
        # JSON-array responses are not truncated at their first object.
        for start_char, end_char in (("[", "]"), ("{", "}")):
            start = text.find(start_char)
            if start == -1:
                continue
            depth = 0
            in_string = False
            escape = False
            for i in range(start, len(text)):
                ch = text[i]
                if escape:
                    escape = False
                    continue
                if ch == "\\":
                    escape = True
                    continue
                if ch == '"':
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if ch == start_char:
                    depth += 1
                elif ch == end_char:
                    depth -= 1
                    if depth == 0:
                        return json.loads(text[start : i + 1])
        raise ValueError(f"No JSON object/array found in response: {text[:200]}")

    def _parse_response(self, content: str) -> EmotionResult:
        """Backward-compatible single-text parser."""
        data = self._extract_json(content)
        if isinstance(data, list):
            data = data[0] if data else {}
        if not isinstance(data, dict):
            raise ValueError(f"Expected JSON object, got {type(data).__name__}")
        return EmotionResult(**{k: float(data.get(k, 0.0)) for k in EMOTION_LABELS})

    def _parse_group_response(self, content: str, expected_count: int, target_emotions: list[str] | None = None) -> list[EmotionResult]:
        emotions = target_emotions or EMOTION_LABELS
        data = self._extract_json(content)
        if isinstance(data, dict):
            scores = data.get("scores")
        elif isinstance(data, list):
            scores = data
        else:
            scores = None

        if not isinstance(scores, list):
            raise ValueError(f"Expected JSON array of scores, got {type(data).__name__}")
        if len(scores) != expected_count:
            raise ValueError(
                f"Score count mismatch: expected {expected_count} items, got {len(scores)}"
            )

        results: list[EmotionResult] = []
        for item in scores:
            result = EmotionResult()
            if isinstance(item, dict):
                for e in emotions:
                    try:
                        setattr(result, e, float(item.get(e, 0.0)))
                    except (TypeError, ValueError):
                        setattr(result, e, 0.0)
            results.append(result)
        return results

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def analyze(self, text: str, context: list[str] | None = None) -> EmotionResult:
        user_msg = self._build_user_message(text, context)
        max_tokens = 200

        if self.provider == "claude":
            system_blocks = self._build_claude_system()
            content = self._call_claude(system_blocks, user_msg, max_tokens)
        elif self.provider == "deepseek":
            system_prompt = self._build_system_prompt()
            content = self._call_deepseek(system_prompt, user_msg, max_tokens)
        else:
            # Single-text fallback uses a flat JSON object, not the group scores schema.
            system_prompt = self._build_system_prompt()
            content = self._call_openai(system_prompt, user_msg, max_tokens, use_json_schema=False)

        return self._parse_response(content)

    def analyze_group(
        self,
        voices: list[VoiceItem],
        personas: dict[str, dict] | None = None,
        target_emotions: list[str] | None = None,
    ) -> list[EmotionResult]:
        if not voices:
            return []

        # Remember original input order and sort by frame for monotonic chunking.
        indexed = list(enumerate(voices))
        indexed.sort(key=lambda iv: (iv[1].frame, iv[0]))
        sorted_voices = [v for _, v in indexed]

        if len(sorted_voices) <= _CHUNK_SIZE:
            chunk_results = self._analyze_chunk(sorted_voices, personas, target_emotions)
            sorted_results = chunk_results
        else:
            sorted_results = self._analyze_chunked(sorted_voices, personas, target_emotions)

        # Map back to original input order.
        results_by_input_index = [None] * len(voices)
        for sorted_idx, input_idx in enumerate(idx for idx, _ in indexed):
            results_by_input_index[input_idx] = sorted_results[sorted_idx]

        if any(r is None for r in results_by_input_index):
            raise ValueError("Failed to produce a result for every input voice")
        return results_by_input_index

    def _analyze_chunked(
        self,
        voices: list,
        personas: dict[str, dict] | None,
        target_emotions: list[str] | None,
    ) -> list[EmotionResult]:
        stride = _CHUNK_SIZE - _CHUNK_OVERLAP * 2  # 16
        chunks: list[dict] = []
        pos = 0
        while pos < len(voices):
            main_start = pos
            main_end = min(len(voices), pos + stride)
            start = max(0, main_start - _CHUNK_OVERLAP)
            end = min(len(voices), main_end + _CHUNK_OVERLAP)
            chunks.append({
                "voices": voices[start:end],
                "start": start,
                "end": end,
                "main_start": main_start,
                "main_end": main_end,
            })
            if end == len(voices):
                break
            pos += stride

        results_by_pos: dict[int, EmotionResult] = {}
        for chunk in chunks:
            chunk_results = self._analyze_chunk(chunk["voices"], personas, target_emotions)
            for idx, res in enumerate(chunk_results):
                pos = chunk["start"] + idx
                # Authoritative chunk is the one whose main range contains this position.
                if chunk["main_start"] <= pos < chunk["main_end"]:
                    results_by_pos[pos] = res
                elif pos not in results_by_pos:
                    results_by_pos[pos] = res

        if len(results_by_pos) != len(voices):
            raise ValueError(
                f"Chunk merge produced {len(results_by_pos)} results for {len(voices)} voices"
            )
        return [results_by_pos[i] for i in range(len(voices))]

    def _analyze_chunk(
        self,
        voices: list,
        personas: dict[str, dict] | None,
        target_emotions: list[str] | None,
    ) -> list[EmotionResult]:
        user_msg = self._build_group_user_message(voices, target_emotions)
        # JSON array output can be token-heavy; give a generous budget while
        # still capping per-request cost.
        max_tokens = max(500, len(voices) * 80)

        if self.provider == "claude":
            system_blocks = self._build_claude_system(target_emotions, personas)
            content = self._call_claude(system_blocks, user_msg, max_tokens)
        elif self.provider == "deepseek":
            system_prompt = self._build_system_prompt(target_emotions, personas)
            content = self._call_deepseek(system_prompt, user_msg, max_tokens)
        else:
            system_prompt = self._build_system_prompt(target_emotions, personas)
            try:
                content = self._call_openai(system_prompt, user_msg, max_tokens, use_json_schema=True, target_emotions=target_emotions)
            except Exception as exc:
                logger.warning("OpenAI json_schema failed (%s), falling back to json_object", exc)
                content = self._call_openai(system_prompt, user_msg, max_tokens, use_json_schema=False, target_emotions=target_emotions)

        return self._parse_group_response(content, len(voices), target_emotions)
