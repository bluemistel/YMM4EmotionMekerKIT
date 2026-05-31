from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class CharacterConfig:
    preset_ini: str = ""
    tachie_dir: str = ""
    layer_offset: int = 1
    emotion_presets: dict[str, str] = field(default_factory=dict)
    compound_presets_2: dict[str, str] = field(default_factory=dict)
    compound_presets_3: dict[str, str] = field(default_factory=dict)
    compound_max_score: float = 0.65
    emotion_parts: dict[str, dict[str, str]] = field(default_factory=dict)
    gradient_presets: dict[str, str] = field(default_factory=dict)

    @property
    def default_preset(self) -> str:
        return self.emotion_presets.get("default", "")


@dataclass
class Settings:
    emotion_model: str = "local"
    model_path: str = "patrickramos/bert-base-japanese-v2-wrime-fine-tune"
    emotion_threshold: float = 0.3
    context_window: int = 3
    extend_expression: bool = True
    max_gap_extend: int = 300
    postprocess_enabled: bool = False
    decay_rate: float = 0.0
    gradient_sudden_threshold: float = 0.4
    gradient_gradual_window: int = 3
    gradient_gradual_max_delta: float = 0.15
    ymm4_exe_path: str = ""
    llm_api_key: str = ""


@dataclass
class ProjectConfig:
    settings: Settings = field(default_factory=Settings)
    characters: dict[str, CharacterConfig] = field(default_factory=dict)

    def get_character(self, name: str) -> CharacterConfig | None:
        return self.characters.get(name)


def load_config(path: str | Path) -> ProjectConfig:
    path = Path(path)
    with open(path, "r", encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f) or {}

    settings_raw = raw.get("settings", {})
    settings = Settings(
        emotion_model=settings_raw.get("emotion_model", "local"),
        model_path=settings_raw.get("model_path", "models/wrime-roberta"),
        emotion_threshold=settings_raw.get("emotion_threshold", 0.3),
        context_window=settings_raw.get("context_window", 3),
        extend_expression=settings_raw.get("extend_expression", True),
        max_gap_extend=settings_raw.get("max_gap_extend", 300),
        postprocess_enabled=settings_raw.get("postprocess_enabled", False),
        decay_rate=settings_raw.get("decay_rate", 0.0),
        gradient_sudden_threshold=settings_raw.get("gradient_sudden_threshold", 0.4),
        gradient_gradual_window=settings_raw.get("gradient_gradual_window", 3),
        gradient_gradual_max_delta=settings_raw.get("gradient_gradual_max_delta", 0.15),
        ymm4_exe_path=settings_raw.get("ymm4_exe_path", ""),
        llm_api_key=settings_raw.get("llm_api_key", ""),
    )

    characters: dict[str, CharacterConfig] = {}
    for name, char_raw in raw.get("characters", {}).items():
        # Backward compat: old "compound_presets" → "compound_presets_2"
        cp2 = char_raw.get("compound_presets_2", char_raw.get("compound_presets", {}))
        characters[name] = CharacterConfig(
            preset_ini=char_raw.get("preset_ini", ""),
            tachie_dir=char_raw.get("tachie_dir", ""),
            layer_offset=char_raw.get("layer_offset", 1),
            emotion_presets=char_raw.get("emotion_presets", {}),
            compound_presets_2=cp2,
            compound_presets_3=char_raw.get("compound_presets_3", {}),
            compound_max_score=char_raw.get("compound_max_score", 0.65),
            emotion_parts=char_raw.get("emotion_parts", {}),
            gradient_presets=char_raw.get("gradient_presets", {}),
        )

    return ProjectConfig(settings=settings, characters=characters)


def save_config(config: ProjectConfig, path: str | Path) -> None:
    path = Path(path)
    data: dict[str, Any] = {
        "settings": {
            "emotion_model": config.settings.emotion_model,
            "model_path": config.settings.model_path,
            "emotion_threshold": config.settings.emotion_threshold,
            "context_window": config.settings.context_window,
            "extend_expression": config.settings.extend_expression,
            "max_gap_extend": config.settings.max_gap_extend,
            "postprocess_enabled": config.settings.postprocess_enabled,
            "decay_rate": config.settings.decay_rate,
            "gradient_sudden_threshold": config.settings.gradient_sudden_threshold,
            "gradient_gradual_window": config.settings.gradient_gradual_window,
            "gradient_gradual_max_delta": config.settings.gradient_gradual_max_delta,
            "ymm4_exe_path": config.settings.ymm4_exe_path,
            "llm_api_key": config.settings.llm_api_key,
        },
        "characters": {},
    }
    for name, char in config.characters.items():
        data["characters"][name] = {
            "preset_ini": char.preset_ini,
            "tachie_dir": char.tachie_dir,
            "layer_offset": char.layer_offset,
            "emotion_presets": char.emotion_presets,
            "compound_presets_2": char.compound_presets_2,
            "compound_presets_3": char.compound_presets_3,
            "compound_max_score": char.compound_max_score,
            "emotion_parts": char.emotion_parts,
            "gradient_presets": char.gradient_presets,
        }

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def get_data_dir() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR


def auto_save_config(config: ProjectConfig) -> Path:
    path = get_data_dir() / "config.yaml"
    save_config(config, path)
    return path


def auto_load_config() -> ProjectConfig | None:
    path = get_data_dir() / "config.yaml"
    if path.exists():
        return load_config(path)
    return None


def generate_template_config(
    character_names: list[str],
    preset_names_per_character: dict[str, list[str]],
    tachie_dirs: dict[str, str],
) -> ProjectConfig:
    characters: dict[str, CharacterConfig] = {}
    for name in character_names:
        presets = preset_names_per_character.get(name, [])
        tachie_dir = tachie_dirs.get(name, "")
        preset_ini = str(Path(tachie_dir) / "preset.ini") if tachie_dir else ""

        default_preset = ""
        for p in presets:
            if "通常" in p:
                default_preset = p
                break

        characters[name] = CharacterConfig(
            preset_ini=preset_ini,
            tachie_dir=tachie_dir,
            emotion_presets={
                "joy": "",
                "anger": "",
                "sadness": "",
                "happiness": "",
                "surprise": "",
                "embarrassment": "",
                "default": default_preset,
            },
        )
    return ProjectConfig(characters=characters)
