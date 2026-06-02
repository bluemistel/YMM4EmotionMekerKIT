from __future__ import annotations

import logging

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from .base import EmotionAnalyzer, EmotionResult

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "patrickramos/bert-base-japanese-v2-wrime-fine-tune"

# WRIME v2 has 16 outputs: writer_* (0-7) then reader_* (8-15), same emotion order.
# The model outputs regression values (intensity 0-3), not probabilities.
WRIME_LABELS = ["joy", "sadness", "anticipation", "surprise", "anger", "fear", "disgust", "trust"]
WRITER_OFFSET = 0
READER_OFFSET = 8

# WRIME(8感情) → アプリ感情への二段マッピング。
# 各 WRIME 感情はリスト先頭が「主ターゲット（重み1.0）」、以降が「補助寄与」。
# 嫌悪/恐れは独立カテゴリ(主)を持ちつつ、従来 怒/驚/哀 に効いていた補助信号も残す。
# 主ターゲットが無効化された WRIME 感情は寄与を全て捨てる（補助も含む）。
WRIME_TO_TARGET: dict[str, list[tuple[str, float]]] = {
    "joy": [("joy", 1.0)],
    "sadness": [("sadness", 1.0)],
    "anticipation": [("happiness", 1.0)],
    "surprise": [("surprise", 1.0)],
    "anger": [("anger", 1.0)],
    "trust": [("embarrassment", 1.0)],
    "fear": [("fear", 1.0), ("surprise", 0.3), ("sadness", 0.3)],
    "disgust": [("disgust", 1.0), ("anger", 0.3)],
}

MAX_INTENSITY = 3.0


class BertEmotionAnalyzer(EmotionAnalyzer):
    def __init__(self, model_name_or_path: str = DEFAULT_MODEL, reader_weight: float = 0.0):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info("Loading emotion model: %s on %s", model_name_or_path, self.device)
        self.tokenizer = AutoTokenizer.from_pretrained(model_name_or_path)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name_or_path)
        self.model.to(self.device)
        self.model.eval()
        # 視聴者視点(reader)感情の混合率。主処理側から実行ごとに更新してよい。
        self.reader_weight = float(reader_weight)
        # 無効化されたアプリ感情。主ターゲットが無効な WRIME 感情は寄与ごと捨てる。
        self.disabled_emotions: set[str] = set()

    @staticmethod
    def _join_context(context: list[str] | None) -> str:
        if not context:
            return ""
        # 話者タグ付きの直前ターンは呼び出し側で整形済み。[SEP] 相当の区切りで連結。
        return " ".join(c for c in context if c)

    def _tokenize(self, texts: list[str], contexts: list[list[str]] | None):
        """文脈がある項目は文ペア符号化（[CLS] 文脈 [SEP] 対象 [SEP] + token_type_ids）。

        文脈の有無が混在しても、空文脈は空文字列の第1セグメントとして扱えば
        バッチで一括符号化できる（対象は常に第2セグメント=対象として区別される）。
        """
        if contexts is None:
            contexts = [[] for _ in texts]
        ctx_strs = [self._join_context(c) for c in contexts]
        if any(ctx_strs):
            return self.tokenizer(
                text=ctx_strs,
                text_pair=texts,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding=True,
            )
        # 文脈が全く無ければ単文符号化（学習分布に近い）。
        return self.tokenizer(
            text=texts,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )

    def _logits_to_emotion(self, logits: torch.Tensor) -> EmotionResult:
        values = logits.cpu().tolist()
        w = max(0.0, min(1.0, self.reader_weight))

        # WRIME 8感情ごとに writer/reader を 0-1 正規化してブレンド。
        blended: dict[str, float] = {}
        for i, label in enumerate(WRIME_LABELS):
            wi = WRITER_OFFSET + i
            ri = READER_OFFSET + i
            writer = values[wi] / MAX_INTENSITY if wi < len(values) else 0.0
            reader = values[ri] / MAX_INTENSITY if ri < len(values) else writer
            val = (1.0 - w) * writer + w * reader
            blended[label] = max(0.0, min(val, 1.0))

        disabled = self.disabled_emotions or set()
        result = EmotionResult()
        for wrime_label, score in blended.items():
            targets = WRIME_TO_TARGET.get(wrime_label, [])
            if not targets:
                continue
            # 主ターゲット(先頭)が無効なら、その WRIME 信号は補助寄与ごと捨てる。
            if targets[0][0] in disabled:
                continue
            for target, weight in targets:
                if target in disabled:
                    continue
                contrib = max(0.0, min(score * weight, 1.0))
                current = getattr(result, target)
                setattr(result, target, max(current, contrib))
        return result

    def analyze(self, text: str, context: list[str] | None = None) -> EmotionResult:
        inputs = self._tokenize([text], [context or []])
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            logits = self.model(**inputs).logits[0]
        return self._logits_to_emotion(logits)

    def analyze_batch(self, texts: list[str], contexts: list[list[str]] | None = None) -> list[EmotionResult]:
        if not texts:
            return []
        inputs = self._tokenize(texts, contexts)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            all_logits = self.model(**inputs).logits
        return [self._logits_to_emotion(logits) for logits in all_logits]
