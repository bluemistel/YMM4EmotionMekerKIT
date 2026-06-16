# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

from .config import CharacterConfig
from .emotion.base import EmotionResult
from .preset_loader import PresetCollection

# 単独感情の強度しきい値（スコア 0–1。WRIME 整数段階 1.5/2.5 を /3 正規化した中点）。
# 弱: [emotion_threshold, WEAK_MAX) / 中: [WEAK_MAX, STRONG_MIN) / 強: [STRONG_MIN, 1]
INTENSITY_WEAK_MAX = 0.5
INTENSITY_STRONG_MIN = 0.83


class ExpressionMapper:
    def __init__(
        self,
        char_config: CharacterConfig,
        presets: PresetCollection,
        weak_max: float = INTENSITY_WEAK_MAX,
        strong_min: float = INTENSITY_STRONG_MIN,
    ):
        self.char_config = char_config
        self.presets = presets
        # 単独感情の弱/強しきい値（ユーザー設定で調整可能）。
        self.weak_max = weak_max
        self.strong_min = strong_min

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

        # 3. Single emotion: highest score（強度別の弱/中/強で分岐）
        best_emotion = ranked[0][0]
        best_score = ranked[0][1]
        if best_score >= self.strong_min:
            tier = "strong"
        elif best_score < self.weak_max:
            tier = "weak"
        else:
            tier = "mid"
        preset_name = ""
        if tier in ("weak", "strong"):
            preset_name = self.char_config.emotion_intensity_presets.get(best_emotion, {}).get(tier, "")
        # 強度別が未設定 or 中 → 既存の単独プリセット（=中/標準）へフォールバック。
        if not preset_name:
            preset_name = self.char_config.emotion_presets.get(best_emotion, "")
            tier = "mid"
        if preset_name and preset_name in self.presets.presets:
            slot_key = f"emotion:{best_emotion}" if tier == "mid" else f"emotion:{best_emotion}:{tier}"
            return (slot_key, preset_name)

        # 4. Default
        return ("default", self._default_preset())

    def detect_slot(self, emotion: EmotionResult, threshold: float = 0.3) -> dict:
        """スコア＋しきい値から「該当する感情の組み合わせ/単独の強弱」を返す（表示ガイド用）。

        resolve_slot の『検出部分』と同じ判定基準（compound_max での複合化、上位3感情、
        弱/強しきい値）を使う。マッピング(プリセット)の有無には依存しない純粋な検出のみ。
        プリセット割り当て（遡りフォールバック含む）は resolution 側で別途行う。
        戻り値: {"kind": "compound3"|"compound2"|"single"|"default",
                 "emotions": [感情キー...], "tier": "weak"|"mid"|"strong"|None}
        """
        active = emotion.above_threshold(threshold)
        if not active:
            return {"kind": "default", "emotions": [], "tier": None}
        ranked = sorted(active.items(), key=lambda x: x[1], reverse=True)
        top = ranked[0][1]
        compound_max = self.char_config.compound_max_score
        if top <= compound_max and len(ranked) >= 3:
            return {"kind": "compound3", "emotions": [r[0] for r in ranked[:3]], "tier": None}
        if top <= compound_max and len(ranked) >= 2:
            return {"kind": "compound2", "emotions": [r[0] for r in ranked[:2]], "tier": None}
        emo = ranked[0][0]
        score = ranked[0][1]
        if score >= self.strong_min:
            tier = "strong"
        elif score < self.weak_max:
            tier = "weak"
        else:
            tier = "mid"
        return {"kind": "single", "emotions": [emo], "tier": tier}

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
