# -*- mode: python ; coding: utf-8 -*-
# SPDX-License-Identifier: AGPL-3.0-or-later
"""PyInstaller spec — FastAPI バックエンドを単体実行ファイル(onedir)に同梱する。

Python 未導入のユーザーでも動くよう、torch/transformers/fugashi(unidic) 等の
依存を丸ごとバンドルする。エントリは run_server.py（uvicorn.run でアプリ起動）。

ビルド:
    pyinstaller --noconfirm --clean ymm4_backend.spec --distpath dist --workpath build_pyi
出力:
    dist/ymm4-backend/ymm4-backend.exe （+ _internal/ 依存一式）
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = []
binaries = []
hiddenimports = []

# 動的 import が多い／データファイルを持つ依存は collect_all で丸ごと取り込む。
# torch / numpy / tokenizers / PIL は PyInstaller の内蔵フックに任せる（重複/肥大回避）。
for pkg in (
    "transformers",
    "huggingface_hub",
    "safetensors",
    "regex",
    "unidic_lite",   # MeCab 辞書データ（BertJapaneseTokenizer が使用）
    "fugashi",       # MeCab ラッパ（コンパイル拡張）
    "psd_tools",
    "fastapi",
    "starlette",
    "pydantic",
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as e:  # noqa: BLE001
        print(f"[spec] collect_all({pkg}) skipped: {e}")

# uvicorn / アプリ本体は動的 import を取りこぼさないよう submodule を全取り込み。
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("app")
hiddenimports += [
    "anyio",
    "h11",
    "click",
    "yaml",
    "fugashi.fugashi",
]

a = Analysis(
    ["run_server.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest", "IPython", "notebook"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ymm4-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="ymm4-backend",
)
