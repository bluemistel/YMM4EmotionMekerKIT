from __future__ import annotations

from .config import CharacterConfig
from .emotion.base import EmotionResult
from .preset_loader import PresetCollection


class ExpressionMapper:
    def __init__(self, char_config: CharacterConfig, presets: PresetCollection):
        self.char_config = char_config
        self.presets = presets

    def resolve_slot(
        self, emotion: EmotionResult, threshold: float = 0.3
    ) -> tuple[str, str]:
        """Returns (slot_key, preset_name) using the same branch order as
        map_emotion. slot_key vocabulary:
          - "default"
          - "compound3:<e1+e2+e3>"
          - "compound2:<e1+e2>"
          - "emotion:<emo>"
        """
        active = emotion.above_threshold(threshold)
        if not active:
            return ("default", self._default_preset())

        ranked = sorted(active.items(), key=lambda x: x[1], reverse=True)
        top_score = ranked[0][1]
        compound_max = self.char_config.compound_max_score

        # 1. Triple compound: top1+top2+top3 (top1 <= compound_max)
        if top_score <= compound_max and len(ranked) >= 3:
            key_3 = "+".join(r[0] for r in ranked[:3])
            preset = self.char_config.compound_presets_3.get(key_3, "")
            if preset and preset in self.presets.presets:
                return (f"compound3:{key_3}", preset)

        # 2. Double compound: top1+top2 (top1 <= compound_max)
        if top_score <= compound_max and len(ranked) >= 2:
            key_2 = "+".join(r[0] for r in ranked[:2])
            preset = self.char_config.compound_presets_2.get(key_2, "")
            if preset and preset in self.presets.presets:
                return (f"compound2:{key_2}", preset)

        # 3. Single emotion: highest score
        best_emotion = ranked[0][0]
        preset_name = self.char_config.emotion_presets.get(best_emotion, "")
        if preset_name and preset_name in self.presets.presets:
            return (f"emotion:{best_emotion}", preset_name)

        # 4. Default
        return ("default", self._default_preset())

    def map_emotion(self, emotion: EmotionResult, threshold: float = 0.3) -> str:
        return self.resolve_slot(emotion, threshold)[1]

    def _default_preset(self) -> str:
        default = self.char_config.default_preset
        if default and default in self.presets.presets:
            return default
        names = self.presets.get_preset_names()
        return names[0] if names else ""

    def resolve_parts(self, emotion: EmotionResult, threshold: float = 0.3) -> dict[str, str | None]:
        preset_name = self.map_emotion(emotion, threshold)
        parts = self.presets.resolve_face_params(preset_name)

        active = emotion.above_threshold(threshold)
        for emotion_label in active:
            overrides = self.char_config.emotion_parts.get(emotion_label, {})
            for field_name, filename in overrides.items():
                from .preset_loader import resolve_part_path
                parts[field_name] = resolve_part_path(
                    self.presets.directory, field_name, filename
                )

        return parts
