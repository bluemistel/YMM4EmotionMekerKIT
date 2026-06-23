# SPDX-License-Identifier: AGPL-3.0-or-later
"""backend/.venv がなければ作成し、pyproject.toml の依存をインストールする。"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / "backend" / ".venv"

# Python <3.11 用のフォールバック。pyproject.toml と同期させること。
_FALLBACK_DEPS = [
    "fastapi>=0.115",
    "uvicorn>=0.34",
    "pyyaml>=6.0",
    "transformers>=4.45",
    "torch>=2.4",
    "fugashi>=1.3",
    "unidic-lite>=1.0.8",
    "psd-tools>=1.17",
    "anthropic",
    "openai",
    "pytest",
    "httpx",
    "pyinstaller",
]


def _venv_python() -> Path:
    if sys.platform == "win32":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def _create_venv() -> None:
    if VENV.exists():
        return

    # uv があれば uv で作成（速い）。なければ標準 venv。
    if shutil.which("uv"):
        print(f"[setup] creating venv with uv at {VENV}")
        subprocess.check_call(["uv", "venv", str(VENV), "--python", sys.executable])
        return

    import venv

    print(f"[setup] creating venv at {VENV}")
    venv.create(VENV, with_pip=True)


def _has_pip(python: Path) -> bool:
    try:
        subprocess.check_call(
            [str(python), "-m", "pip", "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False


def _ensure_pip(python: Path) -> None:
    if _has_pip(python):
        return
    print("[setup] pip not found, bootstrapping...")
    subprocess.check_call([str(python), "-m", "ensurepip", "--upgrade"])


def _read_deps() -> list[str]:
    pyproject = ROOT / "pyproject.toml"
    try:
        if sys.version_info >= (3, 11):
            import tomllib
        else:
            import tomli as tomllib
    except ImportError:
        return _FALLBACK_DEPS.copy()

    try:
        with open(pyproject, "rb") as f:
            data = tomllib.load(f)
    except Exception:
        return _FALLBACK_DEPS.copy()

    deps = list(data.get("project", {}).get("dependencies", []))
    optional = data.get("project", {}).get("optional-dependencies", {})
    for extra in ("llm", "dev"):
        deps.extend(optional.get(extra, []))
    deps.append("pyinstaller")
    return deps


def _install() -> None:
    python = _venv_python()
    deps = _read_deps()

    # uv で作成された venv には pip がないことがある。uv 経由でインストールする。
    if shutil.which("uv"):
        print("[setup] installing dependencies with uv...")
        subprocess.check_call(["uv", "pip", "install", "-p", str(VENV), *deps])
        return

    _ensure_pip(python)
    print("[setup] installing dependencies with pip...")
    subprocess.check_call([str(python), "-m", "pip", "install", "--quiet", *deps])


def main() -> None:
    _create_venv()
    _install()
    print(f"[setup] done: {_venv_python()}")


if __name__ == "__main__":
    main()
