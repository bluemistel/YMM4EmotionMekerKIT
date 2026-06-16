# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

FACE_PARAM_TYPE = (
    "YukkuriMovieMaker.Plugin.Tachie.AnimationTachie.FaceParameter, "
    "YukkuriMovieMaker.Plugin.Tachie.AnimationTachie"
)
TACHIE_FACE_ITEM_TYPE = (
    "YukkuriMovieMaker.Project.Items.TachieFaceItem, YukkuriMovieMaker"
)
PSD_FACE_PARAM_TYPE = (
    "YukkuriMovieMaker.Plugin.Tachie.Psd.PsdTachieFaceParameter, "
    "YukkuriMovieMaker.Plugin.Tachie.Psd"
)


def build_face_parameter(
    parts: dict[str, str | None],
    eye_animation: str = "Default",
    mouth_animation: str = "VolumeLipSyncPriority",
) -> dict:
    return {
        "$type": FACE_PARAM_TYPE,
        "EyeAnimation": eye_animation,
        "MouthAnimation": mouth_animation,
        "Eyebrow": parts.get("Eyebrow"),
        "Eye": parts.get("Eye"),
        "Mouth": parts.get("Mouth"),
        "Hair": parts.get("Hair"),
        "Complexion": parts.get("Complexion"),
        "Body": parts.get("Body"),
        "Back1": parts.get("Back1"),
        "Back2": parts.get("Back2"),
        "Back3": parts.get("Back3"),
        "Etc1": parts.get("Etc1"),
        "Etc2": parts.get("Etc2"),
        "Etc3": parts.get("Etc3"),
    }


def build_tachie_face_item(
    character_name: str,
    frame: int,
    length: int,
    layer: int,
    parts: dict[str, str | None],
    group: int = 0,
    eye_animation: str = "Default",
    mouth_animation: str = "VolumeLipSyncPriority",
    remark: str = "",
) -> dict:
    return {
        "$type": TACHIE_FACE_ITEM_TYPE,
        "CharacterName": character_name,
        "TachieFaceParameter": build_face_parameter(
            parts, eye_animation, mouth_animation
        ),
        "TachieFaceEffects": [],
        "Group": group,
        "Frame": frame,
        "Layer": layer,
        "KeyFrames": {"Frames": [], "Count": 0},
        "Length": length,
        "PlaybackRate": 100.0,
        "ContentOffset": "00:00:00",
        "Remark": remark,
        "IsLocked": False,
        "IsHidden": False,
    }


def build_psd_face_parameter(
    psd_path: str,
    enable_layers: list[str],
    eye_animation: str = "Default",
    mouth_animation: str = "Default",
) -> dict:
    return {
        "$type": PSD_FACE_PARAM_TYPE,
        "IsEnabled": True,
        "FilePath": psd_path,
        "EnableLayers": list(enable_layers),
        "EyeAnimation": eye_animation,
        "MouthAnimation": mouth_animation,
    }


def build_psd_face_item(
    character_name: str,
    frame: int,
    length: int,
    layer: int,
    psd_path: str,
    enable_layers: list[str],
    group: int = 0,
    eye_animation: str = "Default",
    mouth_animation: str = "Default",
    remark: str = "",
) -> dict:
    """PSD立ち絵用の表情アイテム。PNG版と外殻は同形で、TachieFaceParameter を
    PsdTachieFaceParameter（IsEnabled=true で EnableLayers が基準を上書き）にする。"""
    return {
        "$type": TACHIE_FACE_ITEM_TYPE,
        "CharacterName": character_name,
        "TachieFaceParameter": build_psd_face_parameter(
            psd_path, enable_layers, eye_animation, mouth_animation
        ),
        "TachieFaceEffects": [],
        "Group": group,
        "Frame": frame,
        "Layer": layer,
        "KeyFrames": {"Frames": [], "Count": 0},
        "Length": length,
        "PlaybackRate": 100.0,
        "ContentOffset": "00:00:00",
        "Remark": remark,
        "IsLocked": False,
        "IsHidden": False,
    }
