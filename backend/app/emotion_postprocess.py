from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .config import Settings
from .emotion.base import EMOTION_LABELS, EmotionResult
from .ymmp_parser import VoiceItem


@dataclass
class PostProcessedEmotion:
    raw: EmotionResult
    processed: EmotionResult
    gradient: dict[str, float] = field(default_factory=dict)
    gradient_type: str | None = None
    decay_residual: dict[str, float] = field(default_factory=dict)


def apply_postprocessing(
    voices: list[VoiceItem],
    raw_results: dict[int, EmotionResult],
    settings: Settings,
) -> dict[int, PostProcessedEmotion]:
    char_voices: dict[str, list[VoiceItem]] = {}
    for v in voices:
        if v.index in raw_results:
            char_voices.setdefault(v.character_name, []).append(v)

    for char_list in char_voices.values():
        char_list.sort(key=lambda v: v.frame)

    result: dict[int, PostProcessedEmotion] = {}
    gamma = settings.decay_rate

    for char_name, char_list in char_voices.items():
        prev_effective: dict[str, float] = {label: 0.0 for label in EMOTION_LABELS}
        gradient_history: list[dict[str, float]] = []

        for i, voice in enumerate(char_list):
            raw = raw_results[voice.index]
            raw_dict = raw.to_dict()

            effective: dict[str, float] = {}
            residual: dict[str, float] = {}
            for label in EMOTION_LABELS:
                carry = prev_effective[label] * gamma
                effective[label] = min(1.0, raw_dict[label] + carry)
                residual[label] = round(carry, 4)

            gradient: dict[str, float] = {}
            if i == 0:
                gradient = {label: 0.0 for label in EMOTION_LABELS}
            else:
                for label in EMOTION_LABELS:
                    gradient[label] = round(effective[label] - prev_effective[label], 4)

            gradient_type = _classify_gradient(
                gradient,
                gradient_history,
                settings.gradient_sudden_threshold,
                settings.gradient_gradual_window,
                settings.gradient_gradual_max_delta,
            )

            gradient_history.append(gradient)

            result[voice.index] = PostProcessedEmotion(
                raw=raw,
                processed=EmotionResult(**effective),
                gradient=gradient,
                gradient_type=gradient_type,
                decay_residual=residual,
            )

            prev_effective = effective

    return result


def _classify_gradient(
    current_gradient: dict[str, float],
    history: list[dict[str, float]],
    sudden_threshold: float,
    gradual_window: int,
    gradual_max_delta: float,
) -> str | None:
    """Classify a row's gradient as "sudden" / "gradual" / None.

    sudden: any field's |delta| ≥ sudden_threshold this row.
    gradual: the row's DOMINANT label has moved in the same direction
        (with small per-row deltas ≤ gradual_max_delta) for at least
        `gradual_window` rows in total, walking backwards through history.
        Rows where the dominant label is near zero do not break the chain
        (they are skipped as "neutral"); only a sign reversal or an
        oversized step on the dominant label breaks it.
    """
    max_delta = max(abs(v) for v in current_gradient.values()) if current_gradient else 0.0

    if max_delta >= sudden_threshold:
        return "sudden"

    # No movement this row → not gradual
    if max_delta <= 0:
        return None

    # The "dominant" label is the one changing most this row
    dominant_label = max(current_gradient, key=lambda k: abs(current_gradient[k]))
    current_val = current_gradient[dominant_label]
    # Current step itself must be small (otherwise it's better classified as sudden)
    if abs(current_val) > gradual_max_delta:
        return None
    current_sign = 1 if current_val > 0 else -1

    # Walk back through history on the dominant label only, counting how
    # many consecutive rows (including this one) trend in the same direction
    # with small steps. Neutral rows (≈0 on this label) are skipped — they
    # do not extend nor break the chain.
    epsilon = 0.005
    chain_len = 1  # this row counts
    for prev_grad in reversed(history):
        prev_v = prev_grad.get(dominant_label, 0.0)
        if abs(prev_v) <= epsilon:
            # Neutral on this label — skip without breaking the chain
            continue
        if abs(prev_v) > gradual_max_delta:
            # An oversized step on this label breaks the smooth trend
            break
        prev_sign = 1 if prev_v > 0 else -1
        if prev_sign != current_sign:
            break
        chain_len += 1
        if chain_len >= gradual_window:
            return "gradual"

    return "gradual" if chain_len >= gradual_window else None


def resolve_gradient_preset(
    gradient: dict[str, float],
    gradient_type: str | None,
    gradient_presets: dict[str, str],
) -> str | None:
    if not gradient_type:
        return None

    dominant_label = max(gradient, key=lambda k: abs(gradient[k]))
    key = f"{gradient_type}_{dominant_label}"
    return gradient_presets.get(key)
