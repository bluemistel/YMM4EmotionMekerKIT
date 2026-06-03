from __future__ import annotations

"""個人適応学習(#1)の学習データとヘッドの永続化。

- labels.jsonl: ユーザーが手ラベリングした {text, character, emotion, source_project, ts}。
  (text, character) で最新優先のデデュープを行う（同じ台詞を再ラベルしたら上書き）。
- head.pt: 学習済みヘッドの state_dict（personalization 側で読み書き）。
- head_meta.json: 感情別件数・入力次元・学習時刻など。

すべて get_data_dir()/training/ 配下に置き、ユーザー全体（グローバル）で共有する。
"""

import json
import time
from pathlib import Path

from .config import get_data_dir
from .emotion.base import EMOTION_LABELS


def training_dir() -> Path:
    d = get_data_dir() / "training"
    d.mkdir(parents=True, exist_ok=True)
    return d


def labels_path() -> Path:
    return training_dir() / "labels.jsonl"


def head_path() -> Path:
    return training_dir() / "head.pt"


def head_meta_path() -> Path:
    return training_dir() / "head_meta.json"


def load_labels() -> list[dict]:
    """保存済みラベルを (text, character) デデュープ済みで返す（最新優先）。"""
    path = labels_path()
    if not path.exists():
        return []
    by_key: dict[tuple[str, str], dict] = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = (rec.get("text") or "").strip()
            emotion = rec.get("emotion")
            if not text or emotion not in EMOTION_LABELS:
                continue
            key = (text, rec.get("character") or "")
            by_key[key] = rec  # 後勝ち（追記順＝新しい順で上書き）
    return list(by_key.values())


def append_labels(records: list[dict], source_project: str | None = None) -> int:
    """ラベリングセッションの結果を追記する。返り値は追記した有効件数。

    各 record は {text, character?, emotion}。emotion が None/不正の行は「ラベル取消」
    として扱い、空 emotion のレコードを追記する（load 時に無視され、過去ラベルも
    デデュープで上書きされて消える）。
    """
    path = labels_path()
    ts = time.time()
    written = 0
    with open(path, "a", encoding="utf-8") as f:
        for r in records:
            text = (r.get("text") or "").strip()
            if not text:
                continue
            emotion = r.get("emotion")
            rec = {
                "text": text,
                "character": (r.get("character") or ""),
                "emotion": emotion if emotion in EMOTION_LABELS else None,
                "source_project": source_project or r.get("source_project") or "",
                "ts": ts,
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            if rec["emotion"] is not None:
                written += 1
    return written


def label_counts() -> dict[str, int]:
    """感情別の有効ラベル件数（デデュープ後）。"""
    counts = {e: 0 for e in EMOTION_LABELS}
    for rec in load_labels():
        e = rec.get("emotion")
        if e in counts:
            counts[e] += 1
    return counts


def clear_labels() -> None:
    p = labels_path()
    if p.exists():
        p.unlink()


def save_head_meta(meta: dict) -> None:
    with open(head_meta_path(), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def load_head_meta() -> dict | None:
    p = head_meta_path()
    if not p.exists():
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def head_exists() -> bool:
    return head_path().exists() and head_meta_path().exists()
