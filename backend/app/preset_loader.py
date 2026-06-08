from __future__ import annotations

import configparser
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

# Image extensions that can be used as 立ち絵 parts. GIF / WebP are supported by
# YMM4 as "動く立ち絵" (animated tachie) and render natively in <img>.
PART_IMAGE_EXTS = {".png", ".gif", ".webp"}

# Fields whose subdirectories contain blink / lip-sync animation frames that
# must NOT be offered as selectable parts (only the base, mouth-open / eyes-open
# frame should appear).
ANIMATED_FIELDS = {"Eyebrow", "Eye", "Mouth"}

# A lip-sync frame suffix (あいうえお口パク) — single hiragana-vowel romaji token.
_LIPSYNC_TOKENS = {"a", "i", "u", "e", "o"}


def is_animation_frame(filename: str) -> bool:
    """Return True if a part filename is a blink / lip-sync animation frame.

    YMM4 movable parts encode animation frames as a secondary suffix on the
    stem, e.g. ``通常.0.png`` / ``通常.1.png`` (blink frames, 0 = closed),
    or ``通常.a.png`` … ``通常.o.png`` (lip-sync shapes). The plain
    ``通常.png`` (eyes-open / mouth-closed base) must be kept.
    """
    stem = Path(filename).stem  # strips the final .png/.gif/.webp
    head, sep, tail = stem.rpartition(".")
    if not sep:
        return False  # no secondary suffix → base frame, keep
    tail = tail.lower()
    if tail.isdigit():
        return True  # numbered blink / animation frame
    if tail in _LIPSYNC_TOKENS:
        return True  # あいうえお lip-sync frame
    return False

INI_KEY_TO_FIELD = {
    "眉": "Eyebrow",
    "目": "Eye",
    "口": "Mouth",
    "髪": "Hair",
    "顔色": "Complexion",
    "体": "Body",
    "他1": "Etc1",
    "他2": "Etc2",
    "他3": "Etc3",
    "後1": "Back1",
    "後2": "Back2",
    "後3": "Back3",
}

# フィールド名 → preset.ini のキー（保存時に使う逆引き）。
FIELD_TO_INI_KEY = {v: k for k, v in INI_KEY_TO_FIELD.items()}

FIELD_TO_SUBDIR = {
    "Eyebrow": "眉",
    "Eye": "目",
    "Mouth": "口",
    "Hair": "髪",
    "Complexion": "顔色",
    "Body": "体",
    "Etc1": "他",
    "Etc2": "他",
    "Etc3": "他",
    "Back1": "後",
    "Back2": "後",
    "Back3": "後",
}

# Movable tachie packs use either unified subdirs (後/他) or numbered
# subdirs (後1/後2/後3, 他1/他2/他3). For each field we list the
# candidates the resolver should try, in priority order.
FIELD_TO_SUBDIR_CANDIDATES: dict[str, list[str]] = {
    "Eyebrow": ["眉"],
    "Eye": ["目"],
    "Mouth": ["口"],
    "Hair": ["髪"],
    "Complexion": ["顔色"],
    "Body": ["体"],
    "Etc1": ["他1", "他"],
    "Etc2": ["他2", "他"],
    "Etc3": ["他3", "他"],
    "Back1": ["後1", "後"],
    "Back2": ["後2", "後"],
    "Back3": ["後3", "後"],
}


def resolve_part_path(directory: "Path", field_name: str, filename: str) -> str:
    """Return the absolute path for a part file, trying numbered subdirs
    first (e.g. 後3/) then falling back to the unified subdir (e.g. 後/).
    If neither exists, the first candidate is returned so callers still
    see a reasonable path string."""
    from pathlib import Path as _Path
    directory = _Path(directory)
    candidates = FIELD_TO_SUBDIR_CANDIDATES.get(field_name, [FIELD_TO_SUBDIR.get(field_name, "")])
    for sub in candidates:
        p = directory / sub / filename
        if p.exists():
            return str(p)
    # Fallback: first candidate (matches legacy behavior so downstream
    # code that splits by separator still works)
    return str(directory / candidates[0] / filename) if candidates else str(directory / filename)

FACE_PARAM_FIELDS = [
    "Eyebrow", "Eye", "Mouth", "Hair", "Complexion", "Body",
    "Back1", "Back2", "Back3", "Etc1", "Etc2", "Etc3",
]

RENDER_ORDER = [
    "Etc1", "Etc2", "Etc3",
    "Hair",  # semi-transparent pass
    "Eyebrow", "Eye", "Mouth",
    "Hair",  # normal pass
    "Complexion", "Body",
    "Back1", "Back2", "Back3",
]


@dataclass
class Preset:
    name: str
    parts: dict[str, str] = field(default_factory=dict)


@dataclass
class PresetCollection:
    directory: Path
    presets: dict[str, Preset] = field(default_factory=dict)

    def get_preset_names(self) -> list[str]:
        import re

        def natural_sort_key(s: str):
            return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", s)]

        return sorted(self.presets.keys(), key=natural_sort_key)

    def resolve_face_params(self, preset_name: str) -> dict[str, str | None]:
        params: dict[str, str | None] = {f: None for f in FACE_PARAM_FIELDS}
        preset = self.presets.get(preset_name)
        if preset is None:
            return params
        for ini_key, filename in preset.parts.items():
            field_name = INI_KEY_TO_FIELD.get(ini_key)
            if field_name is None:
                continue
            params[field_name] = resolve_part_path(self.directory, field_name, filename)
        return params

    def get_available_files(self) -> dict[str, list[str]]:
        """Return available image files per part field. Numbered subdirs
        (e.g. 後3/) take precedence over the unified subdir (e.g. 後/),
        with the union of both listed if the unified subdir also exists."""
        result: dict[str, list[str]] = {}
        for field_name, candidates in FIELD_TO_SUBDIR_CANDIDATES.items():
            files: list[str] = []
            seen: set[str] = set()
            exclude_anim = field_name in ANIMATED_FIELDS
            for sub in candidates:
                dir_path = self.directory / sub
                if not dir_path.is_dir():
                    continue
                for f in sorted(dir_path.iterdir()):
                    if f.suffix.lower() not in PART_IMAGE_EXTS:
                        continue
                    if f.name in seen:
                        continue
                    # 眉/目/口: drop blink & lip-sync animation frames so only
                    # the base (eyes-open / mouth-closed) file is selectable.
                    if exclude_anim and is_animation_frame(f.name):
                        continue
                    files.append(f.name)
                    seen.add(f.name)
            result[field_name] = files
        return result


def load_preset_ini(ini_path: str | Path, tachie_directory: str | Path | None = None) -> PresetCollection:
    ini_path = Path(ini_path)
    if tachie_directory is None:
        tachie_directory = ini_path.parent
    else:
        tachie_directory = Path(tachie_directory)

    presets: dict[str, Preset] = {}

    with open(ini_path, "r", encoding="utf-8-sig") as f:
        current_section: str | None = None
        current_parts: dict[str, str] = {}

        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("[") and line.endswith("]"):
                if current_section is not None:
                    presets[current_section] = Preset(name=current_section, parts=current_parts)
                current_section = line[1:-1]
                current_parts = {}
            elif "=" in line and current_section is not None:
                key, _, value = line.partition("=")
                current_parts[key.strip()] = value.strip()

        if current_section is not None:
            presets[current_section] = Preset(name=current_section, parts=current_parts)

    return PresetCollection(directory=tachie_directory, presets=presets)


# preset.ini のセクション名/キーに使えない文字。
_INI_NAME_BAD = set("[]\r\n=")


def merge_ini_parts(base_parts: dict[str, str], part_overrides: dict[str, str] | None) -> dict[str, str]:
    """ベースプリセットの parts（INIキー→ファイル名）に、パーツ個別変更
    （フィールド名→ファイル名）を重ねた最終 INIキー→ファイル名 を返す。

    part_overrides の値が空文字なら「そのパーツを削除」（preset から除く）。
    """
    merged: dict[str, str] = dict(base_parts or {})
    for field_name, filename in (part_overrides or {}).items():
        ini_key = FIELD_TO_INI_KEY.get(field_name)
        if ini_key is None:
            continue
        if not filename:  # "" / None = パーツなし → 削除
            merged.pop(ini_key, None)
        else:
            # ファイル名のみにする（パス区切りが含まれていても basename を採用）。
            merged[ini_key] = filename.replace("\\", "/").split("/")[-1]
    return merged


def append_preset_ini(ini_path: str | Path, name: str, parts: dict[str, str]) -> None:
    """preset.ini の末尾に新しい [name] セクションを追記する（YMM4 と同じ追加方式）。

    既存内容は一切書き換えず末尾に足すだけ。改行が無い終端でも壊れないよう、
    必要に応じて空行を補ってから追記する。
    """
    ini_path = Path(ini_path)
    name = (name or "").strip()
    if not name or any(c in _INI_NAME_BAD for c in name):
        raise ValueError("プリセット名に使用できない文字が含まれています（[] = 改行 は不可）")

    lines = [f"[{name}]"]
    for ini_key, filename in parts.items():
        if filename:
            lines.append(f"{ini_key}={filename}")
    block = "\n".join(lines) + "\n"

    prefix = ""
    if ini_path.exists():
        existing = ini_path.read_text(encoding="utf-8-sig")
        if existing and not existing.endswith("\n"):
            prefix = "\n\n"
        elif existing and not existing.endswith("\n\n"):
            prefix = "\n"
    # 既存の BOM は read_text(utf-8-sig) で除去されるが、追記は本文のみなので
    # ファイル先頭の BOM は維持される（'a' で本文だけ足す）。
    with open(ini_path, "a", encoding="utf-8") as f:
        f.write(prefix + block)
