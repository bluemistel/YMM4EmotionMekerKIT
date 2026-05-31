from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict


EMOTION_LABELS = ["joy", "anger", "sadness", "happiness", "surprise", "embarrassment"]

EMOTION_LABELS_JA = {
    "joy": "喜",
    "anger": "怒",
    "sadness": "哀",
    "happiness": "楽",
    "surprise": "驚き",
    "embarrassment": "照れ",
}


@dataclass
class EmotionResult:
    joy: float = 0.0
    anger: float = 0.0
    sadness: float = 0.0
    happiness: float = 0.0
    surprise: float = 0.0
    embarrassment: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return asdict(self)

    def dominant(self) -> str | None:
        scores = self.to_dict()
        if not scores:
            return None
        best = max(scores, key=scores.get)  # type: ignore
        return best if scores[best] > 0 else None

    def above_threshold(self, threshold: float) -> dict[str, float]:
        return {k: v for k, v in self.to_dict().items() if v >= threshold}


class EmotionAnalyzer(ABC):
    @abstractmethod
    def analyze(self, text: str, context: list[str] | None = None) -> EmotionResult:
        ...

    def analyze_batch(self, texts: list[str], contexts: list[list[str]] | None = None) -> list[EmotionResult]:
        if contexts is None:
            contexts = [[] for _ in texts]
        return [self.analyze(t, c) for t, c in zip(texts, contexts)]
