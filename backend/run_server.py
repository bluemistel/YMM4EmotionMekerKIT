"""PyInstaller 用バックエンド起動エントリ。

`python -m uvicorn` はバンドル後に使えないため、uvicorn をプログラム的に起動する。
Electron からは `ymm4-backend.exe --host 127.0.0.1 --port <port>` で呼ばれる。

HuggingFace モデルのキャッシュは書込可能なユーザー領域へ向ける（バンドル内は読取専用）。
"""

from __future__ import annotations

import argparse
import multiprocessing
import os
import sys
from pathlib import Path


def _data_dir() -> Path:
    env = os.environ.get("YMM4_DATA_DIR")
    if env:
        return Path(env)
    if getattr(sys, "frozen", False):
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "YMM4EmotionMakerKIT" / "data"
    return Path(__file__).resolve().parent / "data"


def _ensure_cache_env() -> None:
    """transformers/torch がモデルを書ける場所を保証する（import より前に設定）。"""
    d = _data_dir()
    os.environ.setdefault("HF_HOME", str(d / "hf"))
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    # 凍結バイナリでの multiprocessing 既定をスレッド寄りに（torch のワーカ暴発防止）。
    os.environ.setdefault("OMP_NUM_THREADS", os.environ.get("OMP_NUM_THREADS", "4"))


def main() -> None:
    multiprocessing.freeze_support()
    _ensure_cache_env()

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    import uvicorn
    from app.main import app

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
