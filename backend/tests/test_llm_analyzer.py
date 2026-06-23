# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import json
import sys
import types
import unittest
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

from app.emotion.base import EMOTION_LABELS, EmotionResult
from app.emotion.llm_analyzer import LlmEmotionAnalyzer


@dataclass
class SimpleVoice:
    index: int
    character_name: str
    serif: str
    frame: int
    length: int
    layer: int = 0


def _make_anthropic_module(response_text: str):
    module = types.ModuleType("anthropic")
    client = MagicMock()
    content = MagicMock()
    content.text = response_text
    client.messages.create.return_value = MagicMock(content=[content])
    module.Anthropic = MagicMock(return_value=client)
    return module


def _make_openai_module(response_text: str):
    module = types.ModuleType("openai")
    client = MagicMock()
    choice = MagicMock()
    choice.message.content = response_text
    client.chat.completions.create.return_value = MagicMock(choices=[choice])
    module.OpenAI = MagicMock(return_value=client)
    return module


def _scores_object(labels: list[str], count: int, value: float = 0.0) -> str:
    scores = [{lab: value for lab in labels} for _ in range(count)]
    return json.dumps({"scores": scores})


def _scores_array(labels: list[str], count: int, value: float = 0.0) -> str:
    scores = [{lab: value for lab in labels} for _ in range(count)]
    return json.dumps(scores)


class TestLlmEmotionAnalyzerClaude(unittest.TestCase):
    def test_system_uses_content_blocks_with_cache_control(self):
        voices = [
            SimpleVoice(0, "A", "おはよう！", 0, 10),
            SimpleVoice(1, "B", "うん、おはよう。", 15, 10),
        ]
        response = _scores_array(EMOTION_LABELS, len(voices))
        fake_anthropic = _make_anthropic_module(response)

        analyzer = LlmEmotionAnalyzer(provider="claude", api_key="test-key")
        with patch.dict(sys.modules, {"anthropic": fake_anthropic}):
            results = analyzer.analyze_group(voices)

        fake_anthropic.Anthropic.assert_called_once_with(api_key="test-key")
        client = fake_anthropic.Anthropic.return_value
        call_kwargs = client.messages.create.call_args.kwargs

        self.assertEqual(call_kwargs["model"], "claude-sonnet-4-6")
        self.assertEqual(call_kwargs["temperature"], 0)
        system = call_kwargs["system"]
        self.assertIsInstance(system, list)
        self.assertTrue(
            any(block.get("cache_control") == {"type": "ephemeral"} for block in system)
        )
        user_msg = call_kwargs["messages"][0]["content"]
        self.assertIn("おはよう！", user_msg)
        self.assertIn("うん、おはよう。", user_msg)
        self.assertEqual(len(results), len(voices))


class TestLlmEmotionAnalyzerOpenAI(unittest.TestCase):
    def test_uses_json_schema_with_strict_and_scores_array(self):
        voices = [
            SimpleVoice(0, "A", "嬉しい！", 0, 10),
            SimpleVoice(1, "B", "そうなんだ。", 15, 10),
        ]
        response = _scores_object(EMOTION_LABELS, len(voices))
        fake_openai = _make_openai_module(response)

        analyzer = LlmEmotionAnalyzer(provider="openai", api_key="test-key")
        with patch.dict(sys.modules, {"openai": fake_openai}):
            results = analyzer.analyze_group(voices)

        fake_openai.OpenAI.assert_called_once_with(api_key="test-key", base_url=None)
        client = fake_openai.OpenAI.return_value
        call_kwargs = client.chat.completions.create.call_args.kwargs

        self.assertEqual(call_kwargs["model"], "gpt-5.4-mini")
        rf = call_kwargs["response_format"]
        self.assertEqual(rf["type"], "json_schema")
        self.assertTrue(rf["json_schema"]["strict"])
        schema = rf["json_schema"]["schema"]
        self.assertIn("scores", schema["properties"])
        self.assertEqual(schema["properties"]["scores"]["type"], "array")
        self.assertEqual(len(results), len(voices))

    def test_json_schema_fallback_to_json_object_on_error(self):
        voices = [
            SimpleVoice(0, "A", "嬉しい！", 0, 10),
        ]
        response = _scores_object(EMOTION_LABELS, len(voices))
        fake_openai = _make_openai_module(response)
        client = fake_openai.OpenAI.return_value
        client.chat.completions.create.side_effect = [
            RuntimeError("json_schema unsupported"),
            MagicMock(choices=[MagicMock(message=MagicMock(content=response))]),
        ]

        analyzer = LlmEmotionAnalyzer(provider="openai", api_key="test-key")
        with patch.dict(sys.modules, {"openai": fake_openai}):
            results = analyzer.analyze_group(voices)

        self.assertEqual(client.chat.completions.create.call_count, 2)
        second_call = client.chat.completions.create.call_args_list[1].kwargs
        self.assertEqual(second_call["response_format"]["type"], "json_object")
        self.assertEqual(len(results), len(voices))


class TestLlmEmotionAnalyzerDeepSeek(unittest.TestCase):
    def test_uses_openai_with_deepseek_base_url_and_json_object(self):
        voices = [
            SimpleVoice(0, "A", "よろしく。", 0, 10),
            SimpleVoice(1, "B", "こちらこそ。", 15, 10),
        ]
        response = _scores_object(EMOTION_LABELS, len(voices))
        fake_openai = _make_openai_module(response)

        analyzer = LlmEmotionAnalyzer(provider="deepseek", api_key="test-key")
        with patch.dict(sys.modules, {"openai": fake_openai}):
            results = analyzer.analyze_group(voices)

        fake_openai.OpenAI.assert_called_once_with(
            api_key="test-key", base_url="https://api.deepseek.com"
        )
        client = fake_openai.OpenAI.return_value
        call_kwargs = client.chat.completions.create.call_args.kwargs

        self.assertEqual(call_kwargs["model"], "deepseek-v4-flash")
        self.assertEqual(call_kwargs["response_format"]["type"], "json_object")
        self.assertEqual(call_kwargs.get("extra_body", {}).get("thinking", {}).get("type"), "disabled")
        self.assertEqual(len(results), len(voices))


class TestTargetEmotions(unittest.TestCase):
    def test_schema_and_prompt_only_include_enabled_emotions(self):
        voices = [
            SimpleVoice(0, "A", "嬉しい！", 0, 10),
            SimpleVoice(1, "B", "怒った。", 15, 10),
        ]
        target = ["joy", "anger"]
        response = json.dumps({"scores": [{"joy": 0.9, "anger": 0.1}, {"joy": 0.0, "anger": 0.9}]})
        fake_openai = _make_openai_module(response)

        analyzer = LlmEmotionAnalyzer(provider="openai", api_key="test-key")
        with patch.dict(sys.modules, {"openai": fake_openai}):
            analyzer.analyze_group(voices, target_emotions=target)

        client = fake_openai.OpenAI.return_value
        call_kwargs = client.chat.completions.create.call_args.kwargs
        rf = call_kwargs["response_format"]
        item_schema = rf["json_schema"]["schema"]["properties"]["scores"]["items"]
        self.assertEqual(set(item_schema["properties"].keys()), {"joy", "anger"})
        self.assertEqual(item_schema["required"], ["joy", "anger"])
        system_msg = call_kwargs["messages"][0]["content"]
        base_instruction = system_msg.split("【判定例】")[0]
        self.assertIn("joy", base_instruction)
        self.assertIn("anger", base_instruction)
        self.assertNotIn("sadness", base_instruction)
        self.assertNotIn("happiness", base_instruction)


class TestPersonaInjection(unittest.TestCase):
    def test_persona_text_appears_in_system_prompt(self):
        voices = [
            SimpleVoice(0, "A", "うれしい！", 0, 10),
        ]
        response = _scores_array(EMOTION_LABELS, len(voices))
        fake_anthropic = _make_anthropic_module(response)
        personas = {
            "A": {"valence": 0.8, "arousal": 0.6, "strength": 0.9},
        }

        analyzer = LlmEmotionAnalyzer(provider="claude", api_key="test-key")
        with patch.dict(sys.modules, {"anthropic": fake_anthropic}):
            analyzer.analyze_group(voices, personas=personas)

        client = fake_anthropic.Anthropic.return_value
        system_blocks = client.messages.create.call_args.kwargs["system"]
        full_system = "\n".join(block.get("text", "") for block in system_blocks)
        self.assertIn("【キャラクター事前性情報】", full_system)
        self.assertIn("A", full_system)
        self.assertIn("ポジ", full_system)


class TestParsing(unittest.TestCase):
    def test_returns_expected_results_in_input_order(self):
        voices = [
            SimpleVoice(0, "A", "嬉しい！", 0, 10),
            SimpleVoice(1, "B", "悲しい。", 15, 10),
            SimpleVoice(2, "A", "驚き！", 30, 10),
        ]
        scores = [
            {"joy": 0.9, "anger": 0.0, "sadness": 0.0, "happiness": 0.7, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0},
            {"joy": 0.0, "anger": 0.0, "sadness": 0.9, "happiness": 0.0, "surprise": 0.0, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0},
            {"joy": 0.1, "anger": 0.0, "sadness": 0.0, "happiness": 0.0, "surprise": 0.9, "embarrassment": 0.0, "disgust": 0.0, "fear": 0.0, "exasperation": 0.0},
        ]
        response = json.dumps(scores)
        fake_openai = _make_openai_module(response)

        analyzer = LlmEmotionAnalyzer(provider="openai", api_key="test-key")
        with patch.dict(sys.modules, {"openai": fake_openai}):
            results = analyzer.analyze_group(voices)

        self.assertEqual(len(results), 3)
        self.assertAlmostEqual(results[0].joy, 0.9)
        self.assertAlmostEqual(results[1].sadness, 0.9)
        self.assertAlmostEqual(results[2].surprise, 0.9)
        self.assertIsInstance(results[0], EmotionResult)

    def test_mismatch_raises_clear_exception(self):
        voices = [
            SimpleVoice(0, "A", "テスト", 0, 10),
            SimpleVoice(1, "B", "テスト2", 15, 10),
        ]
        response = json.dumps([{"joy": 0.5}])  # only one result for two voices
        fake_openai = _make_openai_module(response)

        analyzer = LlmEmotionAnalyzer(provider="openai", api_key="test-key")
        with patch.dict(sys.modules, {"openai": fake_openai}):
            with self.assertRaisesRegex(ValueError, "Score count mismatch"):
                analyzer.analyze_group(voices)


class TestAnalyzeFallback(unittest.TestCase):
    def test_single_text_analyze_parses_flat_object(self):
        response = json.dumps({"joy": 0.8, "anger": 0.0, "sadness": 0.0, "happiness": 0.3})
        fake_openai = _make_openai_module(response)

        analyzer = LlmEmotionAnalyzer(provider="openai", api_key="test-key")
        with patch.dict(sys.modules, {"openai": fake_openai}):
            result = analyzer.analyze("嬉しい！")

        self.assertIsInstance(result, EmotionResult)
        self.assertAlmostEqual(result.joy, 0.8)
        self.assertAlmostEqual(result.happiness, 0.3)


class TestMissingSetup(unittest.TestCase):
    def test_claude_raises_without_api_key(self):
        analyzer = LlmEmotionAnalyzer(provider="claude", api_key="")
        with self.assertRaises(RuntimeError) as ctx:
            analyzer._get_claude_client()
        self.assertIn("Claude", str(ctx.exception))
        self.assertIn("API キー", str(ctx.exception))

    def test_claude_raises_without_anthropic_package(self):
        analyzer = LlmEmotionAnalyzer(provider="claude", api_key="test-key")
        with patch.dict(sys.modules, {"anthropic": None}, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                analyzer._get_claude_client()
        self.assertIn("anthropic", str(ctx.exception))

    def test_openai_raises_without_api_key(self):
        analyzer = LlmEmotionAnalyzer(provider="openai", api_key="")
        with self.assertRaises(RuntimeError) as ctx:
            analyzer._get_openai_client()
        self.assertIn("OpenAI", str(ctx.exception))
        self.assertIn("API キー", str(ctx.exception))

    def test_deepseek_raises_without_api_key(self):
        analyzer = LlmEmotionAnalyzer(provider="deepseek", api_key="")
        with self.assertRaises(RuntimeError) as ctx:
            analyzer._get_openai_client(base_url="https://api.deepseek.com")
        self.assertIn("DeepSeek", str(ctx.exception))
        self.assertIn("API キー", str(ctx.exception))

    def test_openai_raises_without_openai_package(self):
        analyzer = LlmEmotionAnalyzer(provider="openai", api_key="test-key")
        with patch.dict(sys.modules, {"openai": None}, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                analyzer._get_openai_client()
        self.assertIn("openai", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
