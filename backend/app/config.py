# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class CharacterConfig:
    preset_ini: str = ""
    tachie_dir: str = ""
    # 立ち絵規格: "png"（パーツ画像）/ "psd"（PSD立ち絵）。psd のとき psd_path を使う。
    tachie_type: str = "png"
    psd_path: str = ""
    layer_offset: int = 1
    emotion_presets: dict[str, str] = field(default_factory=dict)
    # 単独感情の強度別プリセット: 感情 → {"weak": プリセット, "strong": プリセット}。
    # 「中」は emotion_presets[感情] を使う（未設定の弱/強も中へフォールバック）。
    emotion_intensity_presets: dict[str, dict[str, str]] = field(default_factory=dict)
    compound_presets_2: dict[str, str] = field(default_factory=dict)
    compound_presets_3: dict[str, str] = field(default_factory=dict)
    compound_max_score: float = 0.65
    emotion_parts: dict[str, dict[str, str]] = field(default_factory=dict)
    gradient_presets: dict[str, str] = field(default_factory=dict)
    # キャラ性格マップ(#4・ゲート機能): 感情価×覚醒度の事前分布。strength=0 で無効。
    persona_valence: float = 0.0   # -1..1 ネガ⇔ポジ
    persona_arousal: float = 0.0   # -1..1 落ち着き⇔ハイテンション
    persona_strength: float = 0.0  # 0=無効

    @property
    def default_preset(self) -> str:
        return self.emotion_presets.get("default", "")


@dataclass
class Settings:
    emotion_model: str = "local"
    model_path: str = "patrickramos/bert-base-japanese-v2-wrime-fine-tune"
    emotion_threshold: float = 0.3
    context_window: int = 3
    # 分析時に対象台詞の直前に含める「ターン数」（話者分離つき文脈）。
    context_turns: int = 2
    # 文脈・対象を「話者名: 台詞」形式にして話者を区別する。
    context_speaker_labels: bool = True
    # 場面/文脈の境界とみなす無音ギャップ（秒）。プロジェクトの FPS でフレーム換算し、
    # この間隔以上空いた箇所で文脈を区切り・余韻をリセット・勾配を計算しない。
    # 0 でも最小1フレーム区切りで運用可能（TTS の「間を空けて区切る」運用に対応）。
    context_gap_seconds: float = 0.4
    # WRIME の reader 感情(視聴者視点)の混合率（0=writerのみ, 1=readerのみ）。
    reader_weight: float = 0.0
    # 単独感情の強度しきい値（スコア0–1）。弱:[threshold, weak_max) / 中:[weak_max, strong_min) / 強:[strong_min,1]。
    # WRIME の整数段階(1.5/2.5 を /3 正規化)が既定だが、ユーザーが調整できる。
    intensity_weak_max: float = 0.5
    intensity_strong_min: float = 0.83
    # 検出を無効化する感情ラベル（空=全有効）。台本に不要な感情を切るのに使う。
    disabled_emotions: list[str] = field(default_factory=list)
    # 分析で検出されなかった感情ラベルを自動的に OFF にする（既定ON）。
    auto_disable_undetected: bool = True
    # プロジェクト読み込み後に感情分析の自動最適化ウィザードを表示する（既定ON）。
    show_optimizer_on_load: bool = True
    extend_expression: bool = True
    max_gap_extend: int = 300
    postprocess_enabled: bool = False
    decay_rate: float = 0.0
    gradient_sudden_threshold: float = 0.4
    gradient_gradual_window: int = 3
    gradient_gradual_max_delta: float = 0.15
    ymm4_exe_path: str = ""
    llm_api_key: str = ""
    # 個人適応学習(#1): 学習済みヘッドによる感情補正の有効化と強度。
    personalization_enabled: bool = False
    personalization_strength: float = 0.5
    # 複合感情の自動ミラー登録: 「喜+驚」を登録すると「驚+喜」等の全順列にも
    # 同じプリセットを自動登録する（既定ON）。マッピング登録の利便機能で、
    # 感情解決ロジックには影響しない。
    compound_auto_mirror: bool = True


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
        context_turns=settings_raw.get("context_turns", 2),
        context_speaker_labels=settings_raw.get("context_speaker_labels", True),
        context_gap_seconds=settings_raw.get("context_gap_seconds", 0.4),
        reader_weight=settings_raw.get("reader_weight", 0.0),
        intensity_weak_max=settings_raw.get("intensity_weak_max", 0.5),
        intensity_strong_min=settings_raw.get("intensity_strong_min", 0.83),
        disabled_emotions=list(settings_raw.get("disabled_emotions", []) or []),
        auto_disable_undetected=settings_raw.get("auto_disable_undetected", True),
        show_optimizer_on_load=settings_raw.get("show_optimizer_on_load", True),
        extend_expression=settings_raw.get("extend_expression", True),
        max_gap_extend=settings_raw.get("max_gap_extend", 300),
        postprocess_enabled=settings_raw.get("postprocess_enabled", False),
        decay_rate=settings_raw.get("decay_rate", 0.0),
        gradient_sudden_threshold=settings_raw.get("gradient_sudden_threshold", 0.4),
        gradient_gradual_window=settings_raw.get("gradient_gradual_window", 3),
        gradient_gradual_max_delta=settings_raw.get("gradient_gradual_max_delta", 0.15),
        ymm4_exe_path=settings_raw.get("ymm4_exe_path", ""),
        llm_api_key=settings_raw.get("llm_api_key", ""),
        personalization_enabled=settings_raw.get("personalization_enabled", False),
        personalization_strength=settings_raw.get("personalization_strength", 0.5),
        compound_auto_mirror=settings_raw.get("compound_auto_mirror", True),
    )

    characters: dict[str, CharacterConfig] = {}
    for name, char_raw in raw.get("characters", {}).items():
        # Backward compat: old "compound_presets" → "compound_presets_2"
        cp2 = char_raw.get("compound_presets_2", char_raw.get("compound_presets", {}))
        characters[name] = CharacterConfig(
            preset_ini=char_raw.get("preset_ini", ""),
            tachie_dir=char_raw.get("tachie_dir", ""),
            tachie_type=char_raw.get("tachie_type", "png"),
            psd_path=char_raw.get("psd_path", ""),
            layer_offset=char_raw.get("layer_offset", 1),
            emotion_presets=char_raw.get("emotion_presets", {}),
            emotion_intensity_presets=char_raw.get("emotion_intensity_presets", {}),
            compound_presets_2=cp2,
            compound_presets_3=char_raw.get("compound_presets_3", {}),
            compound_max_score=char_raw.get("compound_max_score", 0.65),
            emotion_parts=char_raw.get("emotion_parts", {}),
            gradient_presets=char_raw.get("gradient_presets", {}),
            persona_valence=char_raw.get("persona_valence", 0.0),
            persona_arousal=char_raw.get("persona_arousal", 0.0),
            persona_strength=char_raw.get("persona_strength", 0.0),
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
            "context_turns": config.settings.context_turns,
            "context_speaker_labels": config.settings.context_speaker_labels,
            "context_gap_seconds": config.settings.context_gap_seconds,
            "reader_weight": config.settings.reader_weight,
            "intensity_weak_max": config.settings.intensity_weak_max,
            "intensity_strong_min": config.settings.intensity_strong_min,
            "disabled_emotions": config.settings.disabled_emotions,
            "auto_disable_undetected": config.settings.auto_disable_undetected,
            "show_optimizer_on_load": config.settings.show_optimizer_on_load,
            "extend_expression": config.settings.extend_expression,
            "max_gap_extend": config.settings.max_gap_extend,
            "postprocess_enabled": config.settings.postprocess_enabled,
            "decay_rate": config.settings.decay_rate,
            "gradient_sudden_threshold": config.settings.gradient_sudden_threshold,
            "gradient_gradual_window": config.settings.gradient_gradual_window,
            "gradient_gradual_max_delta": config.settings.gradient_gradual_max_delta,
            "ymm4_exe_path": config.settings.ymm4_exe_path,
            "llm_api_key": config.settings.llm_api_key,
            "personalization_enabled": config.settings.personalization_enabled,
            "personalization_strength": config.settings.personalization_strength,
            "compound_auto_mirror": config.settings.compound_auto_mirror,
        },
        "characters": {},
    }
    for name, char in config.characters.items():
        data["characters"][name] = {
            "preset_ini": char.preset_ini,
            "tachie_dir": char.tachie_dir,
            "tachie_type": char.tachie_type,
            "psd_path": char.psd_path,
            "layer_offset": char.layer_offset,
            "emotion_presets": char.emotion_presets,
            "emotion_intensity_presets": char.emotion_intensity_presets,
            "compound_presets_2": char.compound_presets_2,
            "compound_presets_3": char.compound_presets_3,
            "compound_max_score": char.compound_max_score,
            "emotion_parts": char.emotion_parts,
            "gradient_presets": char.gradient_presets,
            "persona_valence": char.persona_valence,
            "persona_arousal": char.persona_arousal,
            "persona_strength": char.persona_strength,
        }

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _resolve_data_dir() -> Path:
    """設定・辞書・学習データ・キャッシュの保存先を決める。

    優先順位:
      1) 環境変数 YMM4_DATA_DIR（Electron が userData 配下を渡す）。
      2) PyInstaller 等で凍結（frozen）時は書込可能なユーザー領域
         （%LOCALAPPDATA%\\YMM4EmotionMakerKIT\\data 等）。バンドル内は読取専用のため。
      3) 開発時は従来どおり backend/data。
    """
    env = os.environ.get("YMM4_DATA_DIR")
    if env:
        return Path(env)
    if getattr(sys, "frozen", False):
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "YMM4EmotionMakerKIT" / "data"
    return Path(__file__).resolve().parent.parent / "data"


DATA_DIR = _resolve_data_dir()


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
    tachie_types: dict[str, str] | None = None,
    psd_paths: dict[str, str] | None = None,
) -> ProjectConfig:
    tachie_types = tachie_types or {}
    psd_paths = psd_paths or {}
    characters: dict[str, CharacterConfig] = {}
    for name in character_names:
        presets = preset_names_per_character.get(name, [])
        ttype = tachie_types.get(name, "png")
        psd_path = psd_paths.get(name, "")
        if ttype == "psd":
            tachie_dir = ""
            preset_ini = ""
        else:
            tachie_dir = tachie_dirs.get(name, "")
            preset_ini = str(Path(tachie_dir) / "preset.ini") if tachie_dir else ""

        default_preset = ""
        for token in ("通常", "デフォ", "ノーマル", "素"):
            for p in presets:
                if token in p:
                    default_preset = p
                    break
            if default_preset:
                break

        characters[name] = CharacterConfig(
            preset_ini=preset_ini,
            tachie_dir=tachie_dir,
            tachie_type=ttype,
            psd_path=psd_path,
            emotion_presets={
                "joy": "",
                "anger": "",
                "sadness": "",
                "happiness": "",
                "surprise": "",
                "embarrassment": "",
                "disgust": "",
                "fear": "",
                "exasperation": "",
                "default": default_preset,
            },
        )
    return ProjectConfig(characters=characters)
