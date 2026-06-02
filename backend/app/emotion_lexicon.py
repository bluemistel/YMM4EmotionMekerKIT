from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import yaml

from .config import get_data_dir
from .emotion.base import EmotionResult, EMOTION_LABELS


@dataclass
class LexiconEntry:
    """語句→感情の補正ルール。

    - pattern: 台詞に含まれていたら発火する部分文字列。
    - emotion: 対象の6感情キーのいずれか。
    - weight: boost なら加算量、set なら設定値（0–1）。
    - mode: "boost"（加算）/ "set"（固定）。
    - char: 特定キャラのみに適用（None=全キャラ）。
    """
    pattern: str
    emotion: str
    weight: float = 0.5
    mode: str = "boost"
    char: str | None = None


def lexicon_path() -> Path:
    return get_data_dir() / "lexicon.yaml"


def load_lexicon() -> list[LexiconEntry]:
    path = lexicon_path()
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw: dict[str, Any] = yaml.safe_load(f) or {}
    except Exception:
        return []
    entries: list[LexiconEntry] = []
    for e in raw.get("entries", []) or []:
        pattern = str(e.get("pattern", "")).strip()
        emotion = e.get("emotion")
        if not pattern or emotion not in EMOTION_LABELS:
            continue
        mode = e.get("mode", "boost")
        entries.append(
            LexiconEntry(
                pattern=pattern,
                emotion=emotion,
                weight=float(e.get("weight", 0.5)),
                mode="set" if mode == "set" else "boost",
                char=(e.get("char") or None),
            )
        )
    return entries


def save_lexicon(entries: list[LexiconEntry]) -> Path:
    path = lexicon_path()
    data = {"entries": [asdict(e) for e in entries]}
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    return path


def entries_from_dicts(items: list[dict]) -> list[LexiconEntry]:
    """API から受け取った dict 群を検証して LexiconEntry に変換。"""
    out: list[LexiconEntry] = []
    for e in items or []:
        pattern = str(e.get("pattern", "")).strip()
        emotion = e.get("emotion")
        if not pattern or emotion not in EMOTION_LABELS:
            continue
        mode = e.get("mode", "boost")
        try:
            weight = float(e.get("weight", 0.5))
        except (TypeError, ValueError):
            weight = 0.5
        out.append(
            LexiconEntry(
                pattern=pattern,
                emotion=emotion,
                weight=max(-1.0, min(weight, 1.0)),
                mode="set" if mode == "set" else "boost",
                char=(e.get("char") or None),
            )
        )
    return out


def apply_lexicon(
    text: str,
    char: str | None,
    result: EmotionResult,
    entries: list[LexiconEntry],
) -> EmotionResult:
    """語句一致したエントリで感情スコアを補正（0–1 にクランプ）。"""
    if not entries or not text:
        return result
    for e in entries:
        if e.char and e.char != char:
            continue
        if e.pattern and e.pattern in text:
            current = getattr(result, e.emotion)
            new_val = e.weight if e.mode == "set" else current + e.weight
            setattr(result, e.emotion, max(0.0, min(new_val, 1.0)))
    return result
