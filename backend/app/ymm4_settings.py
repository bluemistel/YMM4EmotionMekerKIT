# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read YMM4's CharacterSettings.json to obtain the real default 立ち絵
(standing-art) state for a character.

YMM4 stores per-character defaults in
``<exe_dir>/user/setting/<version>/YukkuriMovieMaker.Settings.CharacterSettings.json``.
Each entry's ``TachieDefaultItemParameter`` holds the 12 part fields
(Eyebrow/Eye/Mouth/Hair/Complexion/Body/Back1-3/Etc1-3) as absolute file
paths or null. This is the authoritative default tachie, used by the
preview so the underlying body matches what YMM4 actually shows.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

SETTINGS_FILENAME = "YukkuriMovieMaker.Settings.CharacterSettings.json"

TACHIE_FIELDS = [
    "Eyebrow", "Eye", "Mouth", "Hair", "Complexion", "Body",
    "Back1", "Back2", "Back3", "Etc1", "Etc2", "Etc3",
]


def _version_key(name: str) -> tuple:
    """Sort key for version folder names like '4.52.0.8'. Non-numeric
    names sort lowest."""
    nums = re.findall(r"\d+", name)
    return tuple(int(n) for n in nums) if nums else (-1,)


def find_character_settings_path(exe_path: str) -> Path | None:
    """Locate the latest CharacterSettings.json given the YMM4 exe path.

    Accepts either the exe file path or its containing directory.
    Returns None if nothing usable is found.
    """
    if not exe_path:
        return None
    p = Path(exe_path)
    exe_dir = p.parent if p.suffix.lower() == ".exe" else p
    setting_root = exe_dir / "user" / "setting"
    if not setting_root.is_dir():
        return None

    # Prefer the newest version subfolder that actually contains the file.
    version_dirs = sorted(
        (d for d in setting_root.iterdir() if d.is_dir()),
        key=lambda d: _version_key(d.name),
        reverse=True,
    )
    for d in version_dirs:
        candidate = d / SETTINGS_FILENAME
        if candidate.is_file():
            return candidate

    # Fallback: file directly under setting/
    direct = setting_root / SETTINGS_FILENAME
    return direct if direct.is_file() else None


def _norm(path: str | None) -> str:
    if not path:
        return ""
    return str(Path(path)).rstrip("\\/").lower()


def get_default_tachie_parts(
    exe_path: str,
    character_name: str,
    tachie_dir: str,
) -> dict[str, str | None] | None:
    """Return the TachieDefaultItemParameter (12 fields, abs path or None)
    for the character that best matches ``character_name`` / ``tachie_dir``.

    Match priority: exact Name match first; otherwise Directory match
    (preferring an entry whose Name also matches, else the first). Returns
    None on any failure so callers can fall back gracefully.
    """
    try:
        settings_path = find_character_settings_path(exe_path)
        if settings_path is None:
            return None
        with io.open(settings_path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        characters = data.get("Characters") or []
        if not isinstance(characters, list):
            return None

        target_dir = _norm(tachie_dir)

        name_match = None
        dir_matches: list[dict] = []
        for c in characters:
            if not isinstance(c, dict):
                continue
            if c.get("Name") == character_name:
                name_match = c
                break
            tcp = c.get("TachieCharacterParameter") or {}
            if target_dir and _norm(tcp.get("Directory")) == target_dir:
                dir_matches.append(c)

        chosen = name_match
        if chosen is None and dir_matches:
            # Prefer a dir-match whose Name also equals the requested name,
            # otherwise take the first dir-match.
            chosen = next(
                (c for c in dir_matches if c.get("Name") == character_name),
                dir_matches[0],
            )
        if chosen is None:
            return None

        item = chosen.get("TachieDefaultItemParameter") or {}
        return {field: item.get(field) for field in TACHIE_FIELDS}
    except Exception:
        return None
