from __future__ import annotations

import logging

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from .base import EmotionAnalyzer, EmotionResult

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "patrickramos/bert-base-japanese-v2-wrime-fine-tune"

# WRIME v2 has 16 labels: writer_* (0-7) and reader_* (8-15)
# We use the writer perspective (indices 0-7).
# Emotions: joy, sadness, anticipation, surprise, anger, fear, disgust, trust
# The model outputs regression values (intensity 0-3), not probabilities.
WRITER_LABELS = ["joy", "sadness", "anticipation", "surprise", "anger", "fear", "disgust", "trust"]
WRITER_INDICES = list(range(8))  # first 8 outputs

WRIME_TO_TARGET = {
    "joy": "joy",
    "anger": "anger",
    "sadness": "sadness",
    "anticipation": "happiness",
    "surprise": "surprise",
    "trust": "embarrassment",
    "fear": None,
    "disgust": None,
}

MAX_INTENSITY = 3.0


class BertEmotionAnalyzer(EmotionAnalyzer):
    def __init__(self, model_name_or_path: str = DEFAULT_MODEL):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info("Loading emotion model: %s on %s", model_name_or_path, self.device)
        self.tokenizer = AutoTokenizer.from_pretrained(model_name_or_path)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name_or_path)
        self.model.to(self.device)
        self.model.eval()

        self._id2label = self.model.config.id2label if hasattr(self.model.config, "id2label") else {}

    def _build_input(self, text: str, context: list[str] | None = None) -> str:
        if context:
            ctx = " ".join(context[-3:])
            return f"{ctx} [SEP] {text}"
        return text

    def _logits_to_emotion(self, logits: torch.Tensor) -> EmotionResult:
        values = logits.cpu().tolist()

        # Extract writer emotions (first 8) and normalize from 0-3 scale to 0-1
        raw_scores: dict[str, float] = {}
        for i, label in enumerate(WRITER_LABELS):
            if i < len(values):
                raw_scores[label] = max(0.0, min(values[WRITER_INDICES[i]] / MAX_INTENSITY, 1.0))

        result = EmotionResult()
        for wrime_label, score in raw_scores.items():
            target = WRIME_TO_TARGET.get(wrime_label)
            if target is not None:
                current = getattr(result, target)
                setattr(result, target, max(current, score))
        return result

    def analyze(self, text: str, context: list[str] | None = None) -> EmotionResult:
        input_text = self._build_input(text, context)
        inputs = self.tokenizer(input_text, return_tensors="pt", truncation=True, max_length=512)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits[0]

        return self._logits_to_emotion(logits)

    def analyze_batch(self, texts: list[str], contexts: list[list[str]] | None = None) -> list[EmotionResult]:
        if contexts is None:
            contexts = [[] for _ in texts]

        input_texts = [self._build_input(t, c) for t, c in zip(texts, contexts)]
        inputs = self.tokenizer(
            input_texts, return_tensors="pt", truncation=True,
            max_length=512, padding=True,
        )
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = self.model(**inputs)
            all_logits = outputs.logits

        return [self._logits_to_emotion(logits) for logits in all_logits]
