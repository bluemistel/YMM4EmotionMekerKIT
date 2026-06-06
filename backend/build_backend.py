"""バックエンドを PyInstaller で単体実行ファイル(onedir)にビルドする。

Windows では、前回ビルドした `ymm4-backend.exe` が起動したままだと
`_internal/**/*.pyd` がロックされ、PyInstaller の出力クリーンが
`PermissionError: [WinError 5]` で失敗する。これを防ぐため、ビルド前に
  1) 起動中の ymm4-backend.exe を終了
  2) 出力フォルダ(dist/ymm4-backend, build_pyi)を確実に削除
してから PyInstaller を実行する。
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # backend/
DIST = ROOT / "dist" / "ymm4-backend"
WORK = ROOT / "build_pyi"
SPEC = "ymm4_backend.spec"


def _kill_running_backend() -> None:
    """起動中のバンドル済みバックエンドを終了する（ロック解放）。"""
    if os.name != "nt":
        subprocess.run(["pkill", "-f", "ymm4-backend"], capture_output=True)
        return
    # /T で子プロセスごと、/F で強制終了。未起動でもエラーにしない。
    subprocess.run(
        ["taskkill", "/F", "/T", "/IM", "ymm4-backend.exe"],
        capture_output=True,
    )
    time.sleep(1.0)


def _on_rm_error(func, path, exc):  # Python 3.12+ onexc シグネチャ
    # 読み取り専用属性で消せない場合は属性を外して再試行。
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def _rmtree(p: Path, retries: int = 5) -> None:
    for _ in range(retries):
        if not p.exists():
            return
        try:
            if sys.version_info >= (3, 12):
                shutil.rmtree(p, onexc=_on_rm_error)
            else:  # pragma: no cover
                shutil.rmtree(p, onerror=lambda f, pth, e: _on_rm_error(f, pth, e))
        except Exception:
            pass
        if not p.exists():
            return
        time.sleep(1.0)
    if p.exists():
        raise SystemExit(
            f"出力フォルダを削除できませんでした: {p}\n"
            "別プロセス（実行中の ymm4-backend.exe / インストール済みアプリ / "
            "エクスプローラ等）がファイルを掴んでいないか確認してください。"
        )


def main() -> None:
    print("[build] 起動中のバックエンドを終了します…")
    _kill_running_backend()
    print("[build] 旧ビルド成果物を削除します…")
    _rmtree(DIST)
    _rmtree(WORK)
    print("[build] PyInstaller を実行します…")
    cmd = [
        sys.executable, "-m", "PyInstaller", "--noconfirm",
        SPEC, "--distpath", "dist", "--workpath", "build_pyi",
    ]
    rc = subprocess.call(cmd, cwd=str(ROOT))
    if rc != 0:
        raise SystemExit(rc)
    print(f"[build] 完了: {DIST}")


if __name__ == "__main__":
    main()
