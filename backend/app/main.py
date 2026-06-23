# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import logging
import os
import signal
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .config import (
    DEFAULT_MODEL_PATH,
    CharacterConfig,
    ProjectConfig,
    Settings,
    auto_load_config,
    auto_save_config,
    generate_template_config,
    get_data_dir,
    load_config,
    save_config,
)
from .expression_mapper import ExpressionMapper
from .face_item_builder import build_psd_face_item, build_tachie_face_item
from .grouping import (
    DialogueGroup,
    build_group_contexts,
    build_preceding_contexts,
    detect_groups,
    merge_groups,
    segment_by_gap,
    split_group,
)
from .preset_loader import (
    FIELD_TO_SUBDIR,
    RENDER_ORDER,
    PresetCollection,
    append_preset_ini,
    load_preset_ini,
    merge_ini_parts,
    resolve_part_path,
)
from .psd_loader import load_psd_tachie, reload_psd_tachie
from .ymm4_settings import get_default_tachie_parts
from .timing_engine import FacePlacement, compute_face_placements
from .ymmp_parser import CharacterInfo, VoiceItem, YmmpProject
from .emotion.base import EmotionResult

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="YMM4 EmotionMaker KIT")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


def _start_parent_watchdog() -> None:
    """親プロセス(Electron)が消えたら自分も終了する見張り（孤児化防止）。

    Electron が環境変数 YMM4_PARENT_PID に自身の PID を渡す。クラッシュや
    強制終了で Electron の終了処理(taskkill)がスキップされても、ここでバックエンドが
    自律終了するため、ポート/メモリ/ファイルロックが残らない。
    YMM4_PARENT_PID 未設定（手動起動・dev.js 経由など）では何もしない。
    """
    import os as _os
    import threading

    pid_s = _os.environ.get("YMM4_PARENT_PID")
    if not pid_s:
        return
    try:
        ppid = int(pid_s)
    except ValueError:
        return

    def _watch() -> None:
        import sys as _sys
        import time as _time
        if _sys.platform == "win32":
            import ctypes
            SYNCHRONIZE = 0x00100000
            handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, ppid)
            if not handle:
                return  # 親を掴めない（既に居ない/権限なし）→ 誤終了しないよう監視しない
            # 親プロセスが終了するとハンドルが signaled になる → 即終了。
            ctypes.windll.kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
            _os._exit(0)
        else:
            while True:
                try:
                    _os.kill(ppid, 0)
                except OSError:
                    _os._exit(0)
                _time.sleep(2)

    threading.Thread(target=_watch, daemon=True, name="parent-watchdog").start()


_start_parent_watchdog()


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import traceback
    logger.error("Unhandled error: %s\n%s", exc, traceback.format_exc())
    from fastapi.responses import JSONResponse
    headers = {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "*",
    }
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers=headers,
    )

# In-memory state
_state: dict[str, Any] = {
    "project": None,
    "config": None,
    "config_path": None,
    "presets": {},
    # PSD立ち絵: character_name -> PsdTachie（PNG の "presets" と並列）。
    "psd": {},
    "analyzer": None,
    "analysis_results": {},
    "placements": {},
    "groups": [],
    "overrides": {},
    "lexicon": [],
}

# 起動時にユーザー感情辞書を読み込む（無ければ空）。
try:
    from .emotion_lexicon import load_lexicon as _load_lexicon
    _state["lexicon"] = _load_lexicon()
except Exception:
    _state["lexicon"] = []


# --- Request / Response models ---

class LoadProjectRequest(BaseModel):
    path: str
    timeline_index: int = 0

class LoadPresetRequest(BaseModel):
    character_name: str
    preset_ini_path: str
    tachie_dir: str | None = None

class SaveConfigRequest(BaseModel):
    path: str
    config: dict[str, Any]

class AnalyzeRequest(BaseModel):
    timeline_index: int = 0
    model: str | None = None

class ExecuteRequest(BaseModel):
    timeline_index: int = 0
    output_path: str | None = None
    backup: bool = True

class UpdateCharacterConfigRequest(BaseModel):
    character_name: str
    config: dict[str, Any]

class DetectGroupsRequest(BaseModel):
    timeline_index: int = 0
    gap_threshold: int = 1

class MergeGroupsRequest(BaseModel):
    group_ids: list[int]

class SplitGroupRequest(BaseModel):
    group_id: int
    split_at_voice_index: int

class OverrideRequest(BaseModel):
    preset_name: str | None = None
    part_overrides: dict[str, str] | None = None
    locked: bool = True
    hold_previous: bool = False
    # 「前回の表情を保つ」の持続ターン数。0=従来（自キャラの次台詞まで）。
    # 1以上=後続の別キャラ台詞 N 本だけ保持し、N 本目の終端で終える。
    hold_turns: int = 0
    # 感情で指定: クリック順（最大3）。感情マッピングで表情を解決する。
    emotion_labels: list[str] | None = None
    # 第1感情のみ選択時の強度（"weak"/"mid"/"strong"）。複数選択時は無視。
    emotion_tier: str | None = None
    # PSD立ち絵のパーツ個別変更: レイヤーID -> 強制表示(True)/強制非表示(False) のデルタ。
    # プリセット基準集合に重ねて適用する（プリセット変更に追従）。
    psd_layer_overrides: dict[str, bool] | None = None

class WorkstateSaveRequest(BaseModel):
    path: str

class WorkstateLoadRequest(BaseModel):
    path: str
    timeline_index: int = 0

class LexiconUpdateRequest(BaseModel):
    entries: list[dict[str, Any]]


# --- Project endpoints ---

@app.post("/api/project/load")
def load_project(req: LoadProjectRequest):
    path = Path(req.path)
    if not path.exists():
        raise HTTPException(404, f"File not found: {req.path}")

    project = YmmpProject(path)
    project.load()
    _state["project"] = project

    return _project_info_dict(project, req.timeline_index)


def _project_info_dict(project: YmmpProject, timeline_index: int = 0) -> dict:
    characters = project.get_characters()
    voices = project.get_voice_items(timeline_index)
    video_info = project.get_video_info(timeline_index)
    return {
        "path": str(project.path),
        "characters": [
            {"name": c.name, "tachie_directory": c.tachie_directory, "voice_layer": c.voice_layer, "color": c.color, "tachie_type": c.tachie_type, "psd_path": c.psd_path}
            for c in characters
        ],
        "voice_count": len(voices),
        "video_info": video_info,
        "timeline_count": len(project.timelines),
        "timelines": project.get_timeline_summaries(),
    }


@app.get("/api/project/characters")
def get_characters():
    project: YmmpProject | None = _state["project"]
    if project is None:
        raise HTTPException(400, "No project loaded")
    characters = project.get_characters()
    voice_names = project.get_character_names_from_voices()
    return {
        "characters": [
            {"name": c.name, "tachie_directory": c.tachie_directory, "voice_layer": c.voice_layer, "color": c.color, "tachie_type": c.tachie_type, "psd_path": c.psd_path}
            for c in characters
        ],
        "voice_character_names": voice_names,
    }


@app.get("/api/project/voices")
def get_voices(timeline_index: int = 0):
    project: YmmpProject | None = _state["project"]
    if project is None:
        raise HTTPException(400, "No project loaded")
    voices = project.get_voice_items(timeline_index)
    return {
        "voices": [
            {
                "index": v.index,
                "character_name": v.character_name,
                "serif": v.serif,
                "frame": v.frame,
                "length": v.length,
                "layer": v.layer,
            }
            for v in voices
        ]
    }


# --- Preset endpoints ---

@app.post("/api/preset/load")
def load_preset(req: LoadPresetRequest):
    path = Path(req.preset_ini_path)
    if not path.exists():
        raise HTTPException(404, f"preset.ini not found: {req.preset_ini_path}")

    collection = load_preset_ini(path, req.tachie_dir)
    _state["presets"][req.character_name] = collection

    return {
        "character_name": req.character_name,
        "preset_count": len(collection.presets),
        "preset_names": collection.get_preset_names(),
        "available_files": collection.get_available_files(),
    }


_IMAGE_MEDIA_TYPES = {
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


@app.get("/api/preset/image")
def get_preset_image(path: str):
    p = Path(path)
    ext = p.suffix.lower()
    if not p.exists() or ext not in _IMAGE_MEDIA_TYPES:
        raise HTTPException(404, f"Image not found: {path}")
    # GIF / WebP 動く立ち絵もそのまま配信する（<img> がアニメ再生する）。
    return FileResponse(p, media_type=_IMAGE_MEDIA_TYPES[ext])


@app.get("/api/preset/{character_name}")
def get_presets(character_name: str):
    collection: PresetCollection | None = _state["presets"].get(character_name)
    if collection is None:
        raise HTTPException(404, f"No presets loaded for: {character_name}")
    return {
        "preset_names": collection.get_preset_names(),
        "presets": {
            name: {"parts": p.parts}
            for name, p in collection.presets.items()
        },
    }


def _ymm4_default_parts(character_name: str, collection: PresetCollection) -> dict[str, str | None] | None:
    """Look up YMM4's real default 立ち絵 (TachieDefaultItemParameter) for
    this character, using the configured YMM4 exe path. Returns None if the
    exe path isn't set or no match is found."""
    config: ProjectConfig | None = _state["config"]
    exe_path = config.settings.ymm4_exe_path if config else ""
    if not exe_path:
        return None
    return get_default_tachie_parts(exe_path, character_name, str(collection.directory))


def _compose_preview_parts(
    character_name: str,
    preset_name: str,
    base_preset_name: str | None,
    with_defaults: bool,
    part_overrides: dict[str, str] | None,
) -> dict[str, str | None]:
    """Compose the final preview parts in last-wins order:
    YMM4 default tachie (when with_defaults) → base preset → preset →
    per-part overrides. Each layer only overrides fields it actually sets.
    """
    collection: PresetCollection | None = _state["presets"].get(character_name)
    if collection is None:
        raise HTTPException(404, f"No presets loaded for: {character_name}")

    # Start with all part fields empty (resolve_face_params returns every
    # field keyed to None for an unknown preset name).
    params: dict[str, str | None] = {k: None for k in collection.resolve_face_params("").keys()}

    if with_defaults:
        ymm4_defaults = _ymm4_default_parts(character_name, collection)
        if ymm4_defaults is not None:
            for field_name, val in ymm4_defaults.items():
                if val:
                    params[field_name] = val
        else:
            # Fallback (no exe path / no match): auto-fill only the essential
            # body layers (Body / Hair) with the first available PNG.
            for field_name in ("Body", "Hair"):
                subdir = FIELD_TO_SUBDIR.get(field_name, "")
                if not subdir:
                    continue
                dir_path = collection.directory / subdir
                if not dir_path.is_dir():
                    continue
                pngs = sorted(p.name for p in dir_path.iterdir() if p.suffix.lower() == ".png")
                if pngs:
                    params[field_name] = str(dir_path / pngs[0])

    # Layer 1: base preset (the underlying 立ち絵 preset)
    if base_preset_name and base_preset_name != preset_name:
        base_params = collection.resolve_face_params(base_preset_name)
        for field_name, val in base_params.items():
            if val:
                params[field_name] = val

    # Layer 2: the preset itself
    preset_params = collection.resolve_face_params(preset_name)
    for field_name, val in preset_params.items():
        if val:
            params[field_name] = val

    # Layer 3: per-part overrides (bare filename → resolved path; empty clears)
    for field_name, val in (part_overrides or {}).items():
        if not val:
            params[field_name] = None
        elif "\\" in val or "/" in val:
            params[field_name] = val
        else:
            params[field_name] = resolve_part_path(collection.directory, field_name, val)

    return params


@app.get("/api/preset/{character_name}/{preset_name}/preview")
def get_preset_preview(character_name: str, preset_name: str, with_defaults: bool = False):
    """Return the preset's parts. When `with_defaults=true`, fill missing
    fields from YMM4's real default 立ち絵 (TachieDefaultItemParameter) if the
    YMM4 exe path is configured, else fall back to the first PNG in Body/Hair.
    """
    params = _compose_preview_parts(
        character_name, preset_name, None, with_defaults, None
    )
    return {
        "preset_name": preset_name,
        "parts": params,
        "render_order": RENDER_ORDER,
    }


class PreviewMergeRequest(BaseModel):
    preset_name: str
    base_preset_name: str | None = None
    with_defaults: bool = True
    part_overrides: dict[str, str] | None = None


@app.post("/api/preset/{character_name}/preview")
def post_preset_preview(character_name: str, req: PreviewMergeRequest):
    """Compose a preview from YMM4 default tachie + base preset + preset +
    per-part overrides, returning the final merged parts ready to render."""
    params = _compose_preview_parts(
        character_name,
        req.preset_name,
        req.base_preset_name,
        req.with_defaults,
        req.part_overrides,
    )
    return {
        "preset_name": req.preset_name,
        "parts": params,
        "render_order": RENDER_ORDER,
    }


# --- PSD立ち絵 endpoints ---

def _get_psd_or_404(character_name: str):
    psd = _state["psd"].get(character_name)
    if psd is None:
        # config に psd_path があれば遅延ロードを試みる。
        config: ProjectConfig | None = _state["config"]
        cc = config.get_character(character_name) if config else None
        psd = _get_psd_for(character_name, cc)
    if psd is None:
        # 台詞の無いキャラ（config 未生成）でもプレビューできるよう、
        # プロジェクトの Characters から psd_path を引いて遅延ロードする。
        project: YmmpProject | None = _state["project"]
        if project is not None:
            for ci in project.get_characters():
                if (
                    ci.name == character_name
                    and ci.tachie_type == "psd"
                    and ci.psd_path
                    and Path(ci.psd_path).exists()
                ):
                    psd = load_psd_tachie(ci.psd_path)
                    _state["psd"][character_name] = psd
                    break
    if psd is None:
        raise HTTPException(404, f"No PSD tachie loaded for: {character_name}")
    return psd


class PsdPreviewRequest(BaseModel):
    preset_name: str | None = None
    psd_layer_overrides: dict[str, bool] | None = None


class PsdRenderRequest(BaseModel):
    enable_layers: list[str]


def _apply_layer_overrides(base: list[str], overrides: dict[str, bool] | None) -> list[str]:
    layers = set(base)
    for lid, on in (overrides or {}).items():
        if on:
            layers.add(lid)
        else:
            layers.discard(lid)
    return sorted(layers)


@app.get("/api/psd/{character_name}/tree")
def get_psd_tree(character_name: str):
    psd = _get_psd_or_404(character_name)
    return {
        "tree": psd.layer_tree(),
        "preset_names": psd.get_preset_names(),
        "all_layer_ids": sorted(psd.all_layer_ids()),
    }


@app.post("/api/psd/{character_name}/preview")
def psd_preview(character_name: str, req: PsdPreviewRequest):
    """プリセット名＋レイヤーデルタ → 最終 EnableLayers と合成PNGパスを返す。"""
    psd = _get_psd_or_404(character_name)
    base = psd.resolve_layers(req.preset_name)
    enable = _apply_layer_overrides(base, req.psd_layer_overrides)
    path = psd.render(enable)
    return {
        "preset_name": req.preset_name,
        "base_layers": base,
        "enable_layers": enable,
        "path": str(path),
    }


@app.post("/api/psd/{character_name}/render")
def psd_render(character_name: str, req: PsdRenderRequest):
    """明示的な EnableLayers 集合を合成して PNG パスを返す（フォールバック/高精度確認用）。"""
    psd = _get_psd_or_404(character_name)
    path = psd.render(req.enable_layers)
    return {"enable_layers": sorted(set(req.enable_layers)), "path": str(path)}


@app.get("/api/psd/{character_name}/layers")
def psd_layers(character_name: str, scale: float | None = None):
    """各レイヤーを透明WebPに事前ベイクしたマニフェストを返す（高速プレビュー用）。

    フロントは各画像をCSSで重ね、表示切替はクライアント側のみで行う（往復なし）。
    画像は既存の /api/preset/image?path= で配信する。
    """
    psd = _get_psd_or_404(character_name)
    return psd.bake_layers(scale)


@app.post("/api/psd/{character_name}/resolve")
def psd_resolve(character_name: str, req: PsdPreviewRequest):
    """合成せずに、プリセット基準＋デルタの可視レイヤー集合だけ返す（軽量）。"""
    psd = _get_psd_or_404(character_name)
    return psd.resolve_only(req.preset_name, req.psd_layer_overrides)


# --- パーツ個別変更を YMM4 プリセットとして保存 ---

class SavePngPresetRequest(BaseModel):
    name: str
    base_preset_name: str | None = None
    part_overrides: dict[str, str] | None = None


class SavePsdPresetRequest(BaseModel):
    name: str
    preset_name: str | None = None
    psd_layer_overrides: dict[str, bool] | None = None


@app.post("/api/preset/{character_name}/save-preset")
def save_png_preset(character_name: str, req: SavePngPresetRequest):
    """PNG立ち絵: ベースプリセット＋パーツ個別変更を新プリセットとして preset.ini 末尾に追記。"""
    config: ProjectConfig | None = _state["config"]
    cc = config.get_character(character_name) if config else None
    if cc is None or not cc.preset_ini:
        raise HTTPException(400, f"No preset.ini configured for: {character_name}")
    collection: PresetCollection | None = _state["presets"].get(character_name)
    base_parts: dict[str, str] = {}
    if collection is not None and req.base_preset_name:
        base = collection.presets.get(req.base_preset_name)
        if base is not None:
            base_parts = dict(base.parts)
    merged = merge_ini_parts(base_parts, req.part_overrides)
    try:
        append_preset_ini(cc.preset_ini, req.name, merged)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # 再読込してアプリへ反映。
    col = load_preset_ini(cc.preset_ini, cc.tachie_dir or None)
    _state["presets"][character_name] = col
    return {"status": "saved", "name": req.name.strip(), "preset_names": col.get_preset_names()}


@app.post("/api/psd/{character_name}/save-preset")
def save_psd_preset(character_name: str, req: SavePsdPresetRequest):
    """PSD立ち絵: 現在の可視レイヤー集合を新プリセットとして -ymm.json 末尾に追記。"""
    psd = _get_psd_or_404(character_name)
    enable = psd.resolve_only(req.preset_name, req.psd_layer_overrides)["enable_layers"]
    try:
        psd.append_preset(req.name, enable)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # -ymm.json 変更は PSD mtime を変えないため、キャッシュを破棄して作り直す。
    fresh = reload_psd_tachie(psd.psd_path)
    _state["psd"][character_name] = fresh
    return {"status": "saved", "name": req.name.strip(), "preset_names": fresh.get_preset_names()}


# --- Config endpoints ---

@app.post("/api/config/save")
def save_config_endpoint(req: SaveConfigRequest):
    config = _build_config_from_dict(req.config)
    save_config(config, req.path)
    _state["config"] = config
    _state["config_path"] = req.path
    return {"status": "saved", "path": req.path}


@app.get("/api/config/load")
def load_config_endpoint(path: str):
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, f"Config not found: {path}")
    config = load_config(p)
    _state["config"] = config
    _state["config_path"] = path
    return _config_to_dict(config)


@app.post("/api/config/generate-template")
def generate_template():
    project: YmmpProject | None = _state["project"]
    if project is None:
        raise HTTPException(400, "No project loaded")

    characters = project.get_characters()
    voice_names = project.get_character_names_from_voices()

    preset_names_per_char: dict[str, list[str]] = {}
    tachie_dirs: dict[str, str] = {}
    tachie_types: dict[str, str] = {}
    psd_paths: dict[str, str] = {}
    for c in characters:
        if c.name not in voice_names:
            continue
        if c.tachie_type == "psd" and c.psd_path:
            # PSD立ち絵: .psd を psd_loader でパースし、-ymm.json のプリセット名を採用。
            tachie_types[c.name] = "psd"
            psd_paths[c.name] = c.psd_path
            if Path(c.psd_path).exists():
                psd = load_psd_tachie(c.psd_path)
                preset_names_per_char[c.name] = psd.get_preset_names()
                _state["psd"][c.name] = psd
        elif c.tachie_directory:
            tachie_dirs[c.name] = c.tachie_directory
            ini_path = Path(c.tachie_directory) / "preset.ini"
            if ini_path.exists():
                col = load_preset_ini(ini_path, c.tachie_directory)
                preset_names_per_char[c.name] = col.get_preset_names()
                _state["presets"][c.name] = col

    template = generate_template_config(
        voice_names, preset_names_per_char, tachie_dirs, tachie_types, psd_paths
    )

    # Merge with saved config if available
    saved = auto_load_config()
    if saved:
        # Preserve app-wide settings (感情後処理の有効/無効, exe パス, LLM 設定 等)
        # across project loads — these are not per-project and must not reset.
        template.settings = saved.settings
        for char_name, saved_char in saved.characters.items():
            if char_name in template.characters:
                tmpl_char = template.characters[char_name]
                if any(v for v in saved_char.emotion_presets.values() if v):
                    tmpl_char.emotion_presets = saved_char.emotion_presets
                tmpl_char.emotion_intensity_presets = saved_char.emotion_intensity_presets
                tmpl_char.compound_presets_2 = saved_char.compound_presets_2
                tmpl_char.compound_presets_3 = saved_char.compound_presets_3
                tmpl_char.compound_max_score = saved_char.compound_max_score
                tmpl_char.emotion_parts = saved_char.emotion_parts
                tmpl_char.gradient_presets = saved_char.gradient_presets
                tmpl_char.layer_offset = saved_char.layer_offset
                # キャラ性格マップ(#4)もアプリ共通設定として復元。
                tmpl_char.persona_valence = saved_char.persona_valence
                tmpl_char.persona_arousal = saved_char.persona_arousal
                tmpl_char.persona_strength = saved_char.persona_strength

    _state["config"] = template
    auto_save_config(template)
    return _config_to_dict(template)


@app.post("/api/config/update-character")
def update_character_config(req: UpdateCharacterConfigRequest):
    config: ProjectConfig | None = _state["config"]
    if config is None:
        config = ProjectConfig()
        _state["config"] = config

    char_data = req.config
    cp2 = char_data.get("compound_presets_2", char_data.get("compound_presets", {}))
    # persona は専用UI(PersonaMap)からのみ更新される。感情マッピング等の保存で
    # キーが省略された場合は既存値を保持し、誤ってリセットしないようにする。
    _prev = config.characters.get(req.character_name)
    _pv = char_data.get("persona_valence", _prev.persona_valence if _prev else 0.0)
    _pa = char_data.get("persona_arousal", _prev.persona_arousal if _prev else 0.0)
    _ps = char_data.get("persona_strength", _prev.persona_strength if _prev else 0.0)
    # tachie_type/psd_path はプロジェクト由来。感情マッピング保存等でキーが省略された
    # 場合は既存値を保持して PSD 判定が消えないようにする。
    _tt = char_data.get("tachie_type", _prev.tachie_type if _prev else "png")
    _pp = char_data.get("psd_path", _prev.psd_path if _prev else "")
    config.characters[req.character_name] = CharacterConfig(
        preset_ini=char_data.get("preset_ini", ""),
        tachie_dir=char_data.get("tachie_dir", ""),
        tachie_type=_tt,
        psd_path=_pp,
        layer_offset=char_data.get("layer_offset", 1),
        emotion_presets=char_data.get("emotion_presets", {}),
        emotion_intensity_presets=char_data.get("emotion_intensity_presets", {}),
        compound_presets_2=cp2,
        compound_presets_3=char_data.get("compound_presets_3", {}),
        compound_max_score=char_data.get("compound_max_score", 0.65),
        emotion_parts=char_data.get("emotion_parts", {}),
        gradient_presets=char_data.get("gradient_presets", {}),
        persona_valence=_pv,
        persona_arousal=_pa,
        persona_strength=_ps,
    )
    auto_save_config(config)
    return {"status": "updated", "character_name": req.character_name}


@app.get("/api/config/auto-load")
def auto_load_saved_config():
    config = auto_load_config()
    if config is None:
        raise HTTPException(404, "No saved config found")
    _state["config"] = config
    return _config_to_dict(config)


class UpdateSettingsRequest(BaseModel):
    settings: dict[str, Any]


@app.post("/api/config/update-settings")
def update_settings(req: UpdateSettingsRequest):
    config: ProjectConfig | None = _state["config"]
    if config is None:
        config = ProjectConfig()
        _state["config"] = config

    s = req.settings
    if "postprocess_enabled" in s:
        config.settings.postprocess_enabled = bool(s["postprocess_enabled"])
    if "decay_rate" in s:
        config.settings.decay_rate = float(s["decay_rate"])
    if "gradient_sudden_threshold" in s:
        config.settings.gradient_sudden_threshold = float(s["gradient_sudden_threshold"])
    if "gradient_gradual_window" in s:
        config.settings.gradient_gradual_window = int(s["gradient_gradual_window"])
    if "gradient_gradual_max_delta" in s:
        config.settings.gradient_gradual_max_delta = float(s["gradient_gradual_max_delta"])
    if "ymm4_exe_path" in s:
        config.settings.ymm4_exe_path = str(s["ymm4_exe_path"] or "")
    if "context_turns" in s:
        config.settings.context_turns = int(s["context_turns"])
    if "context_speaker_labels" in s:
        config.settings.context_speaker_labels = bool(s["context_speaker_labels"])
    if "context_gap_seconds" in s:
        config.settings.context_gap_seconds = max(0.0, float(s["context_gap_seconds"]))
    if "reader_weight" in s:
        config.settings.reader_weight = float(s["reader_weight"])
    if "intensity_weak_max" in s:
        config.settings.intensity_weak_max = max(0.0, min(1.0, float(s["intensity_weak_max"])))
    if "intensity_strong_min" in s:
        config.settings.intensity_strong_min = max(0.0, min(1.0, float(s["intensity_strong_min"])))
    if "disabled_emotions" in s:
        from .emotion.base import EMOTION_LABELS
        config.settings.disabled_emotions = [
            e for e in (s["disabled_emotions"] or []) if e in EMOTION_LABELS
        ]
    if "auto_disable_undetected" in s:
        config.settings.auto_disable_undetected = bool(s["auto_disable_undetected"])
    if "show_optimizer_on_load" in s:
        config.settings.show_optimizer_on_load = bool(s["show_optimizer_on_load"])
    if "personalization_enabled" in s:
        config.settings.personalization_enabled = bool(s["personalization_enabled"])
    if "personalization_strength" in s:
        config.settings.personalization_strength = max(0.0, min(1.0, float(s["personalization_strength"])))
    if "compound_auto_mirror" in s:
        config.settings.compound_auto_mirror = bool(s["compound_auto_mirror"])

    # 感情分析モデル / LLM API キー。変更時は analyzer キャッシュを破棄して
    # 次回分析で新しいプロバイダ/キーが確実に使われるようにする。
    model_changed = False
    if "emotion_model" in s:
        new_model = str(s["emotion_model"] or "local")
        if new_model != config.settings.emotion_model:
            model_changed = True
        config.settings.emotion_model = new_model
    if "llm_api_key" in s:
        new_key = str(s["llm_api_key"] or "")
        if new_key != config.settings.llm_api_key:
            model_changed = True
        config.settings.llm_api_key = new_key
    if "llm_model" in s:
        new_model_id = str(s["llm_model"] or "")
        if new_model_id != config.settings.llm_model:
            model_changed = True
        config.settings.llm_model = new_model_id
    if model_changed:
        _state["analyzer"] = None

    auto_save_config(config)
    return {"status": "updated"}


# --- Group endpoints ---

@app.post("/api/groups/detect")
def detect_dialogue_groups(req: DetectGroupsRequest):
    project: YmmpProject | None = _state["project"]
    if project is None:
        raise HTTPException(400, "No project loaded")

    voices = project.get_voice_items(req.timeline_index)
    groups = detect_groups(voices, req.gap_threshold)
    _state["groups"] = groups
    _state["groups_timeline_index"] = req.timeline_index

    return {
        "count": len(groups),
        "groups": [
            {
                "group_id": g.group_id,
                "voice_indices": g.voice_indices,
                "start_frame": g.start_frame,
                "end_frame": g.end_frame,
                "voice_count": len(g.voice_indices),
                "auto_detected": g.auto_detected,
            }
            for g in groups
        ],
    }


@app.get("/api/groups")
def get_groups():
    groups: list[DialogueGroup] = _state.get("groups", [])
    return {
        "count": len(groups),
        "groups": [
            {
                "group_id": g.group_id,
                "voice_indices": g.voice_indices,
                "start_frame": g.start_frame,
                "end_frame": g.end_frame,
                "voice_count": len(g.voice_indices),
                "auto_detected": g.auto_detected,
            }
            for g in groups
        ],
    }


@app.post("/api/groups/merge")
def merge_dialogue_groups(req: MergeGroupsRequest):
    project: YmmpProject | None = _state["project"]
    if project is None:
        raise HTTPException(400, "No project loaded")

    groups: list[DialogueGroup] = _state.get("groups", [])
    timeline_index = _state.get("groups_timeline_index", 0)
    voices = project.get_voice_items(timeline_index)
    updated = merge_groups(groups, req.group_ids, voices)
    _state["groups"] = updated

    return {"count": len(updated)}


@app.post("/api/groups/split")
def split_dialogue_group(req: SplitGroupRequest):
    project: YmmpProject | None = _state["project"]
    if project is None:
        raise HTTPException(400, "No project loaded")

    groups: list[DialogueGroup] = _state.get("groups", [])
    timeline_index = _state.get("groups_timeline_index", 0)
    voices = project.get_voice_items(timeline_index)
    updated = split_group(groups, req.group_id, req.split_at_voice_index, voices)
    _state["groups"] = updated

    return {"count": len(updated)}


# --- Override endpoints ---

@app.post("/api/override/{voice_index}")
def set_override(voice_index: int, req: OverrideRequest):
    _state["overrides"][voice_index] = {
        "preset_name": req.preset_name,
        "part_overrides": req.part_overrides,
        "locked": req.locked,
        "hold_previous": req.hold_previous,
        "hold_turns": req.hold_turns,
        "emotion_labels": req.emotion_labels,
        "emotion_tier": req.emotion_tier,
        "psd_layer_overrides": req.psd_layer_overrides,
    }
    return {"status": "set", "voice_index": voice_index}


@app.delete("/api/override/{voice_index}")
def delete_override(voice_index: int):
    _state["overrides"].pop(voice_index, None)
    return {"status": "deleted", "voice_index": voice_index}


@app.get("/api/overrides")
def get_overrides():
    return {"overrides": _state.get("overrides", {})}


# --- User emotion lexicon (語句→感情の補正辞書) ---

@app.get("/api/lexicon")
def get_lexicon():
    from dataclasses import asdict
    return {"entries": [asdict(e) for e in _state.get("lexicon", [])]}


@app.put("/api/lexicon")
def update_lexicon(req: LexiconUpdateRequest):
    from dataclasses import asdict
    from .emotion_lexicon import entries_from_dicts, save_lexicon
    entries = entries_from_dicts(req.entries)
    _state["lexicon"] = entries
    save_lexicon(entries)
    return {"status": "saved", "count": len(entries), "entries": [asdict(e) for e in entries]}


# --- Personalized learning (個人適応学習) ---

class TrainingLabelsRequest(BaseModel):
    # [{text, character?, emotion(None=取消)}]
    labels: list[dict[str, Any]]
    source_project: str | None = None


def _get_embedding_analyzer():
    """埋め込み可能なローカル BERT アナライザを返す（無ければ生成）。"""
    cur = _state.get("analyzer")
    if cur is not None and hasattr(cur, "embed_batch"):
        return cur
    from .emotion.bert_analyzer import BertEmotionAnalyzer
    config: ProjectConfig | None = _state["config"]
    model_path = config.settings.model_path if config else DEFAULT_MODEL_PATH
    analyzer = BertEmotionAnalyzer(model_path)
    # ローカルモードなら以後も再利用できるようキャッシュ。
    if config and config.settings.emotion_model == "local":
        _state["analyzer"] = analyzer
    return analyzer


@app.get("/api/training/labels")
def get_training_labels():
    from . import training_store, personalization
    return {
        "counts": training_store.label_counts(),
        "total": sum(training_store.label_counts().values()),
        "head": training_store.load_head_meta(),
        "head_available": personalization.is_available(),
    }


@app.post("/api/training/labels")
def add_training_labels(req: TrainingLabelsRequest):
    from . import training_store
    written = training_store.append_labels(req.labels, source_project=req.source_project)
    return {"status": "ok", "written": written, "counts": training_store.label_counts()}


@app.delete("/api/training/labels")
def clear_training_labels():
    """個人学習データを初期化する: 手ラベル(labels.jsonl)と学習済みヘッドを両方削除。

    過学習したヘッドが残ると推論に効き続けるため、ラベルと一緒に消して
    personalization を完全に無効化（次回 rebuild まで base 出力に戻す）。
    """
    from . import training_store, personalization
    training_store.clear_labels()
    training_store.clear_head()
    personalization.invalidate_cache()
    return {"status": "cleared"}


@app.post("/api/training/rebuild")
def rebuild_personalization():
    from . import personalization
    try:
        analyzer = _get_embedding_analyzer()
    except Exception as e:
        raise HTTPException(500, f"モデルの読み込みに失敗しました: {e}")
    stats = personalization.train(analyzer)
    return stats


# --- Work-state (作業状態) save / load ---

WORKSTATE_VERSION = 1


@app.post("/api/workstate/save")
def save_workstate(req: WorkstateSaveRequest):
    """Persist the whole app working state (config / overrides / analysis /
    groups) to a JSON file so it can be restored later."""
    import json
    from dataclasses import asdict

    project: YmmpProject | None = _state["project"]
    config: ProjectConfig | None = _state["config"]
    if project is None:
        raise HTTPException(400, "No project loaded")

    groups: list[DialogueGroup] = _state.get("groups", [])
    # overrides keys may be int; JSON requires str keys.
    overrides = {str(k): v for k, v in _state.get("overrides", {}).items()}

    data = {
        "version": WORKSTATE_VERSION,
        "project_path": str(project.path),
        "config": _config_to_dict(config) if config else None,
        "overrides": overrides,
        "analysis_results": _state.get("analysis_results", {}),
        "groups": [asdict(g) for g in groups],
    }

    out = Path(req.path)
    if out.suffix.lower() != ".ymmemo":
        out = out.with_name(out.name + ".ymmemo") if out.suffix == "" else out.with_suffix(".ymmemo")
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return {"status": "saved", "path": str(out)}


@app.post("/api/workstate/load")
def load_workstate(req: WorkstateLoadRequest):
    """Restore a previously-saved working state: reloads the project, restores
    config (also persisted to config.yaml so generate-template merges it),
    overrides, analysis results and dialogue groups."""
    import json

    wpath = Path(req.path)
    if not wpath.exists():
        raise HTTPException(404, f"Work-state file not found: {req.path}")

    with open(wpath, "r", encoding="utf-8") as f:
        data = json.load(f)

    project_path = Path(data.get("project_path", ""))
    if not project_path.exists():
        raise HTTPException(404, f"Project referenced by work-state not found: {project_path}")

    project = YmmpProject(project_path)
    project.load()
    _state["project"] = project

    # Restore config and persist so generate-template merges it on rebuild.
    cfg_data = data.get("config")
    if cfg_data:
        config = _build_config_from_dict(cfg_data)
        _state["config"] = config
        auto_save_config(config)

    # Restore overrides (coerce keys back to int where possible).
    restored_overrides: dict = {}
    for k, v in (data.get("overrides") or {}).items():
        try:
            restored_overrides[int(k)] = v
        except (TypeError, ValueError):
            restored_overrides[k] = v
    _state["overrides"] = restored_overrides

    _state["analysis_results"] = data.get("analysis_results", {}) or {}

    groups: list[DialogueGroup] = []
    for g in data.get("groups", []) or []:
        try:
            groups.append(DialogueGroup(**g))
        except TypeError:
            continue
    _state["groups"] = groups
    _state["groups_timeline_index"] = req.timeline_index

    info = _project_info_dict(project, req.timeline_index)
    info["has_analysis"] = bool(_state["analysis_results"])
    return info


# --- Analysis endpoints ---

@app.post("/api/analyze")
def analyze_emotions(req: AnalyzeRequest):
    project: YmmpProject | None = _state["project"]
    config: ProjectConfig | None = _state["config"]
    if project is None:
        raise HTTPException(400, "No project loaded")
    if config is None:
        raise HTTPException(400, "No config loaded")

    model_type = req.model or config.settings.emotion_model
    analyzer = _get_or_create_analyzer(model_type, config.settings)
    # reader/writer ブレンド率は実行ごとに反映（モデル再読込は不要）。
    if hasattr(analyzer, "reader_weight"):
        analyzer.reader_weight = config.settings.reader_weight
    # 自動OFF が ON のときは、検出判定のためにマスク前の出力が必要なので
    # アナライザのマッピング段マスクを無効化（後段で実効集合をマスクする）。
    auto_disable = config.settings.auto_disable_undetected
    manual_disabled = set(config.settings.disabled_emotions or [])
    if hasattr(analyzer, "disabled_emotions"):
        analyzer.disabled_emotions = set() if auto_disable else manual_disabled

    voices = project.get_voice_items(req.timeline_index)
    groups: list[DialogueGroup] = _state.get("groups", [])

    # 場面/文脈セグメントを算出（無音ギャップ秒 × プロジェクト FPS でフレーム換算）。
    fps = project.get_fps(req.timeline_index)
    gap_frames = max(1, round(config.settings.context_gap_seconds * fps))
    segment_of = segment_by_gap(voices, gap_frames)

    # 話者分離つき・直前Nターンのみの文脈を構築（対象自身/後続/別セグメントは含めない）。
    speaker_labels = config.settings.context_speaker_labels
    ctx_map = build_preceding_contexts(
        voices, config.settings.context_turns, speaker_labels, segment_of=segment_of
    )
    contexts = [ctx_map.get(v.index, []) for v in voices]

    def _target_text(v: VoiceItem) -> str:
        if speaker_labels and v.character_name:
            return f"{v.character_name}: {v.serif}"
        return v.serif

    if model_type.startswith("llm_"):
        from .emotion.base import EMOTION_LABELS
        target_emotions = [e for e in EMOTION_LABELS if e not in manual_disabled]
        analysis_groups: list[DialogueGroup] = _state.get("groups") or []
        if not analysis_groups:
            analysis_groups = detect_groups(voices, gap_frames)
        index_to_result: dict[int, EmotionResult] = {v.index: EmotionResult() for v in voices}
        for g in analysis_groups:
            group_voices = sorted(
                [v for v in voices if v.index in set(g.voice_indices)],
                key=lambda v: v.frame,
            )
            if not group_voices:
                continue
            group_personas: dict[str, dict] = {}
            for v in group_voices:
                cc = config.characters.get(v.character_name)
                if cc and cc.persona_strength > 0:
                    group_personas[v.character_name] = {
                        "valence": cc.persona_valence,
                        "arousal": cc.persona_arousal,
                        "strength": cc.persona_strength,
                    }
            group_results = analyzer.analyze_group(
                group_voices, group_personas, target_emotions
            )
            for v, r in zip(group_voices, group_results):
                index_to_result[v.index] = r
        results = [index_to_result[v.index] for v in voices]
    else:
        texts = [_target_text(v) for v in voices]
        results = analyzer.analyze_batch(texts, contexts)

    # --- 感情スコアへの補正注入順（統合ポリシー） ---
    # raw(モデル出力)
    #   → persona_prior（キャラの粗い事前分布・中心0バイアス）
    #   → personalization（個人学習ヘッドの中心0バイアス。データ量と強度で自動減衰）
    #   → apply_lexicon（ユーザー辞書＝最後段・最優先。set=ハード上書き／boost=加算アンサンブル）
    #   → 無効マスク → 後処理(勾配/減衰)
    # 辞書を最後段に置くことで、明示ルール（特に set）が学習・事前分布より常に優先される。
    # personalization は辞書語を学習時にダウンウェイトしており、辞書と二重には効きにくい。

    # キャラ性格マップ(#4): 各キャラの感情価×覚醒度の事前分布を加算（粗い prior）。
    # persona_strength=0 のキャラはスキップ。
    from . import persona_prior
    for v, e in zip(voices, results):
        cc = config.characters.get(v.character_name)
        if cc and cc.persona_strength > 0:
            persona_prior.apply(e, cc.persona_valence, cc.persona_arousal, cc.persona_strength)

    # 個人適応学習(#1): 学習済みヘッドがあれば、対象行のみの埋め込みからバイアスを加算。
    # ローカルBERT専用（埋め込みが必要）。LLM 経路では embed_batch が無いのでスキップ。
    if (
        config.settings.personalization_enabled
        and hasattr(analyzer, "embed_batch")
    ):
        from . import personalization
        if personalization.is_available():
            try:
                embeddings = analyzer.embed_batch([v.serif for v in voices])
                personalization.apply(results, embeddings, config.settings.personalization_strength)
            except Exception:
                pass  # 個人適応は補助。失敗しても base 結果で続行。

    # ユーザー感情辞書（語句→感情）の後段補正。
    lexicon = _state.get("lexicon")
    if lexicon:
        from .emotion_lexicon import apply_lexicon
        results = [
            apply_lexicon(v.serif, v.character_name, e, lexicon)
            for v, e in zip(voices, results)
        ]

    # 実効的な無効ラベル集合を決定する。
    from .emotion.base import EMOTION_LABELS
    if auto_disable:
        # マスク前（このループ前）の出力から検出された感情を判定。
        threshold = config.settings.emotion_threshold
        detected: set[str] = set()
        for e in results:
            d = e.to_dict()
            for lab in EMOTION_LABELS:
                if d.get(lab, 0.0) >= threshold:
                    detected.add(lab)
        effective_disabled = set(EMOTION_LABELS) - detected
        # 実効集合を設定として永続化（チェックUIや書き出しと一致させる）。
        new_disabled = sorted(effective_disabled)
        if new_disabled != sorted(config.settings.disabled_emotions or []):
            config.settings.disabled_emotions = new_disabled
            auto_save_config(config)
    else:
        effective_disabled = manual_disabled

    # 無効ラベルを最終マスク（LLM 経路や辞書由来の残差も確実にゼロ化）。
    if effective_disabled:
        for e in results:
            e.mask(effective_disabled)

    post_map = None
    if config.settings.postprocess_enabled:
        from .emotion_postprocess import apply_postprocessing
        raw_map = {v.index: e for v, e in zip(voices, results)}
        post_map = apply_postprocessing(voices, raw_map, config.settings, segment_of=segment_of)

    analysis = {}
    for voice, emotion in zip(voices, results):
        group_id = None
        for g in groups:
            if voice.index in g.voice_indices:
                group_id = g.group_id
                break

        if post_map and voice.index in post_map:
            post = post_map[voice.index]
            analysis[voice.index] = {
                "character_name": voice.character_name,
                "serif": voice.serif,
                "frame": voice.frame,
                "length": voice.length,
                "emotion": post.processed.to_dict(),
                "dominant": post.processed.dominant(),
                "group_id": group_id,
                "raw_emotion": post.raw.to_dict(),
                "gradient": {"values": post.gradient, "type": post.gradient_type},
                "decay": {"residual": post.decay_residual},
                "timeline_index": req.timeline_index,
            }
        else:
            analysis[voice.index] = {
                "character_name": voice.character_name,
                "serif": voice.serif,
                "frame": voice.frame,
                "length": voice.length,
                "emotion": emotion.to_dict(),
                "dominant": emotion.dominant(),
                "group_id": group_id,
                "raw_emotion": None,
                "gradient": None,
                "decay": None,
                "timeline_index": req.timeline_index,
            }

    _resolve_for_analysis(config, analysis, _state.get("overrides", {}))
    # 複数シーン併存: 既存 analysis から当該シーン分のみ除去して当シーンの結果で更新
    # （voice index は全シーン一意なので衝突しない。再分析は当該シーンのみ置換）。
    merged = {
        k: v
        for k, v in _state.get("analysis_results", {}).items()
        if v.get("timeline_index") != req.timeline_index
    }
    merged.update(analysis)
    _state["analysis_results"] = merged
    return {
        "count": len(analysis),
        "results": analysis,
        "disabled_emotions": list(config.settings.disabled_emotions or []),
    }


@app.get("/api/analyze/result")
def get_analysis_result(timeline_index: int | None = None):
    analysis = _state.get("analysis_results", {})
    config: ProjectConfig | None = _state["config"]
    if analysis and config is not None:
        _resolve_for_analysis(config, analysis, _state.get("overrides", {}))
    # シーン指定があれば当該シーンの項目のみ返す（複数シーン併存時のスコープ用）。
    if timeline_index is not None:
        analysis = {
            k: v for k, v in analysis.items() if v.get("timeline_index") == timeline_index
        }
    return {
        "results": analysis,
        "disabled_emotions": list(config.settings.disabled_emotions or []) if config else [],
    }


# --- Execute endpoints ---

@app.get("/api/execute/preview")
def preview_execution(timeline_index: int = 0):
    project: YmmpProject | None = _state["project"]
    config: ProjectConfig | None = _state["config"]
    analysis = _state.get("analysis_results", {})

    if project is None:
        raise HTTPException(400, "No project loaded")
    if config is None:
        raise HTTPException(400, "No config loaded")
    if not analysis:
        raise HTTPException(400, "No analysis results. Run /api/analyze first.")

    all_placements = _compute_all_placements(project, config, analysis, timeline_index)
    return {
        "placements": [
            {
                "character_name": p.character_name,
                "frame": p.frame,
                "length": p.length,
                "layer": p.voice_layer + config.characters.get(p.character_name, CharacterConfig()).layer_offset,
                "preset_name": p.preset_name,
                "source_serifs": p.source_serifs,
            }
            for p in all_placements
        ]
    }


@app.post("/api/execute")
def execute(req: ExecuteRequest):
    project: YmmpProject | None = _state["project"]
    config: ProjectConfig | None = _state["config"]
    analysis = _state.get("analysis_results", {})

    if project is None:
        raise HTTPException(400, "No project loaded")
    if config is None:
        raise HTTPException(400, "No config loaded")
    if not analysis:
        raise HTTPException(400, "No analysis results. Run /api/analyze first.")

    # 解析済みの全シーンを対象にする（複数シーン対応）。各 analysis item の
    # timeline_index から集合を作り、昇順に書き出す（タグが無い旧データは 0 扱い）。
    scene_indices = sorted({int(v.get("timeline_index", 0)) for v in analysis.values()})

    total_face_items = 0
    for tl in scene_indices:
        all_placements = _compute_all_placements(project, config, analysis, tl)
        if not all_placements:
            continue

        face_items = []
        for p in all_placements:
            char_config = config.characters.get(p.character_name, CharacterConfig())
            layer = p.voice_layer + char_config.layer_offset
            if isinstance(p.parts, dict) and "__psd_layers__" in p.parts:
                # PSD立ち絵: PsdTachieFaceParameter（EnableLayers）で書き出す。
                item = build_psd_face_item(
                    character_name=p.character_name,
                    frame=p.frame,
                    length=p.length,
                    layer=layer,
                    psd_path=char_config.psd_path,
                    enable_layers=p.parts["__psd_layers__"],
                    eye_animation=p.parts.get("EyeAnimation", "Default"),
                    mouth_animation=p.parts.get("MouthAnimation", "Default"),
                    remark=f"[Auto] {p.preset_name}",
                )
            else:
                item = build_tachie_face_item(
                    character_name=p.character_name,
                    frame=p.frame,
                    length=p.length,
                    layer=layer,
                    parts=p.parts,
                    remark=f"[Auto] {p.preset_name}",
                )
            face_items.append(item)

        # 重複適用を防ぐため、書き出すキャラの既存表情アイテムを除去してから挿入する
        # （YMM4 は同区間で最下部の1つしか適用しないため、古い手動/前回分が残ると誤適用になる）。
        target_chars = {p.character_name for p in all_placements}
        project.remove_face_items(target_chars, tl)
        project.insert_face_items(face_items, tl)
        total_face_items += len(face_items)

    output_path = req.output_path
    if output_path is None or not str(output_path).strip():
        stem = project.path.stem
        output_path = str(project.path.with_name(f"{stem}_emotion.ymmp"))
    else:
        # 拡張子なし／別拡張子で保存されるミスを防ぐため .ymmp を強制する。
        op = Path(str(output_path).strip())
        if op.suffix.lower() != ".ymmp":
            op = op.with_name(op.name + ".ymmp") if op.suffix == "" else op.with_suffix(".ymmp")
        output_path = str(op)

    saved = project.save(output_path, backup=req.backup)
    return {
        "status": "success",
        "output_path": str(saved),
        "face_items_count": total_face_items,
        "scene_count": len(scene_indices),
    }


# --- Helpers ---

def _apply_part_overrides(parts: dict, part_overrides: dict | None, presets) -> None:
    """パーツ個別変更を resolved parts に上書き適用する（in-place）。

    空文字 = そのパーツを消去（None）。パス区切りを含めば完成パス、素のファイル名なら
    キャラの立ち絵ディレクトリ（番号付きサブディレクトリ優先）から解決する。
    """
    if not part_overrides:
        return
    from .preset_loader import resolve_part_path
    for field_name, val in part_overrides.items():
        if not val:
            parts[field_name] = None
        elif "\\" in val or "/" in val:
            parts[field_name] = val
        else:
            parts[field_name] = resolve_part_path(presets.directory, field_name, val)


def _get_psd_for(char_name: str, char_config):
    """PSD立ち絵キャラの PsdTachie を返す（未ロードなら psd_path から遅延ロード）。"""
    if char_config is None or getattr(char_config, "tachie_type", "png") != "psd":
        return None
    psd = _state["psd"].get(char_name)
    if psd is None and char_config.psd_path and Path(char_config.psd_path).exists():
        psd = load_psd_tachie(char_config.psd_path)
        _state["psd"][char_name] = psd
    return psd


def _psd_parts(psd, preset_name: str | None, psd_layer_overrides: dict | None) -> dict:
    """プリセット基準のレイヤー集合にデルタを重ねた PSD用 parts センチネルを返す。

    timing_engine はこの dict の等価比較で連続結合し、書き出しは "__psd_layers__"
    の有無で PSD アイテムに分岐する。"""
    layers = set(psd.resolve_layers(preset_name))
    for lid, on in (psd_layer_overrides or {}).items():
        if on:
            layers.add(lid)
        else:
            layers.discard(lid)
    return {
        "__psd_layers__": sorted(layers),
        "EyeAnimation": "Default",
        "MouthAnimation": "Default",
    }


def _resolve_voice(mapper, char_config, presets, a: dict, override: dict | None, threshold: float, psd=None):
    """Single source of truth for per-voice expression resolution.

    Returns (slot_key, preset_name, source, parts) where source is one of
    "override" | "gradient" | "mapping". Mirrors the precedence in
    _compute_all_placements exactly so the analyze view and preview/execute
    never drift. For PSD立ち絵 (psd is not None) `parts` is a layer sentinel dict.
    """
    part_overrides = (override or {}).get("part_overrides") or {}
    psd_layer_overrides = (override or {}).get("psd_layer_overrides") or {}
    is_psd = psd is not None

    if override and override.get("preset_name"):
        preset_name = override["preset_name"]
        if is_psd:
            parts = _psd_parts(psd, preset_name, psd_layer_overrides)
        else:
            parts = presets.resolve_face_params(preset_name)
            _apply_part_overrides(parts, part_overrides, presets)
        return ("override", preset_name, "override", parts)

    from .emotion.base import EmotionResult

    # 感情で指定（クリック順）: ランク降順スコアの EmotionResult を合成し、
    # 既存の感情マッピング（単一/複合・強度別）で表情を解決する。
    if override and override.get("emotion_labels"):
        labels = [e for e in override["emotion_labels"] if hasattr(EmotionResult(), e)][:3]
        if labels:
            synth = EmotionResult()
            tier = override.get("emotion_tier")
            if len(labels) == 1 and tier in ("weak", "mid", "strong"):
                # 第1感情のみ: ユーザー指定の強弱帯にスコアを合成し、resolve_slot の
                # 強度別分岐（emotion_intensity_presets、未設定は中へフォールバック）に委ねる。
                # しきい値はユーザー設定（mapper に反映済み）を使う。
                weak_max = mapper.weak_max
                strong_min = mapper.strong_min
                if tier == "weak":
                    score = max(threshold + 0.01, (threshold + weak_max) / 2)
                elif tier == "strong":
                    score = min(1.0, strong_min + 0.05)
                else:
                    score = (weak_max + strong_min) / 2
                setattr(synth, labels[0], score)
            else:
                # 複合（2つ以上）: 拮抗スコアを合成。強弱は意味を成さないため無視。
                cap = min(0.6, max(0.05, char_config.compound_max_score))
                for i, lab in enumerate(labels):
                    setattr(synth, lab, max(threshold + 0.01, cap - i * 0.05))
            slot_key, preset_name = mapper.resolve_slot(synth, threshold)
            if is_psd:
                parts = _psd_parts(psd, preset_name, psd_layer_overrides)
            else:
                parts = mapper.resolve_parts(synth, threshold)
                _apply_part_overrides(parts, part_overrides, presets)
            return (slot_key, preset_name, "override", parts)

    emotion = EmotionResult(**a["emotion"])
    slot_key, preset_name = mapper.resolve_slot(emotion, threshold)
    source = "mapping"

    if a.get("gradient") and a["gradient"].get("type"):
        from .emotion_postprocess import resolve_gradient_preset, gradient_dominant
        gtype = a["gradient"]["type"]
        gvalues = a["gradient"]["values"]
        gp = resolve_gradient_preset(gvalues, gtype, char_config.gradient_presets)
        if gp and gp in presets.presets:
            preset_name = gp
            source = "gradient"
            dominant = gradient_dominant(gvalues)
            slot_key = f"gradient_{gtype}:{dominant}" if dominant else f"gradient_{gtype}:"

    if is_psd:
        parts = _psd_parts(psd, preset_name, psd_layer_overrides)
        # レイヤーのデルタがあれば [個別] 扱いにする（PNG の part_overrides と同様）。
        if psd_layer_overrides:
            source = "override"
        return (slot_key, preset_name, source, parts)

    parts = mapper.resolve_parts(emotion, threshold)

    # パーツ個別変更のみの上書き: 自動解決結果に最終オーバーレイし override 扱いにする。
    # （これが無いと書き出しでパーツ変更が破棄され、[個別]バッジも出ない。）
    if part_overrides:
        _apply_part_overrides(parts, part_overrides, presets)
        source = "override"

    return (slot_key, preset_name, source, parts)


def _build_guide(mapper, char_config, a: dict, override: dict | None, threshold: float) -> dict | None:
    """セリフ一覧のガイド表示用に「該当する感情＋割り当てプリセット」を返す。

    2つは別アルゴリズムなので分けて求める（仕様どおり）:
      - 「該当する感情」(kind/emotions/tier)＝『検出』。スコアからの検出(detect_slot＝既存
        検出ルールと同一)／手動ラベル／勾配(急変・徐々)。マッピング有無では変えない。
      - 「プリセット」(preset_name)＝ resolution.preset_name。resolve_slot の遡り
        （複合3→複合2→単独強弱→単独中→デフォルト）・勾配・上書きを反映した実際の割り当て。
    戻り値: {kind, emotions, tier, preset_name|None, overridden, override_kind, gradient_type}
    """
    res = a.get("resolution")
    if not res:
        return None
    slot = res.get("slot_key") or ""
    preset = res.get("preset_name") or None      # ← 実際に割り当てられるプリセット
    source = res.get("source")
    overridden = source == "override"
    override_kind = None
    if overridden:
        override_kind = "preset" if (override and override.get("preset_name")) else "emotion"

    base = {
        "emotions": [], "tier": None, "preset_name": preset,
        "overridden": overridden, "override_kind": override_kind, "gradient_type": None,
    }

    from .emotion.base import EmotionResult

    # --- 「該当する感情」の検出（マッピング有無に依存しない） ---
    # 1) プリセットで指定（直接）
    if overridden and override and override.get("preset_name"):
        return {**base, "kind": "preset"}
    # 2) 感情で指定（手動ラベル）→ ユーザーが選んだラベルをそのまま表示
    if overridden and override and override.get("emotion_labels"):
        labels = [e for e in override["emotion_labels"] if hasattr(EmotionResult(), e)][:3]
        if labels:
            if len(labels) >= 3:
                return {**base, "kind": "compound3", "emotions": labels}
            if len(labels) == 2:
                return {**base, "kind": "compound2", "emotions": labels}
            t = override.get("emotion_tier")
            return {**base, "kind": "single", "emotions": labels,
                    "tier": t if t in ("weak", "mid", "strong") else "mid"}
    # 3) 感情後処理の勾配が実際に適用されている（resolution が gradient）
    if source == "gradient" and slot.startswith("gradient_"):
        head, _, dom = slot.partition(":")
        return {**base, "kind": "gradient", "gradient_type": head[len("gradient_"):],
                "emotions": [dom] if dom else []}
    # 4) 自動：スコアからの検出（detect_slot）
    detect = mapper.detect_slot(EmotionResult(**a["emotion"]), threshold)
    return {**base, "kind": detect["kind"], "emotions": detect["emotions"], "tier": detect["tier"]}


def _resolve_for_analysis(config: ProjectConfig, analysis: dict, overrides: dict) -> None:
    """Mutate analysis in place, attaching a per-voice `resolution` dict
    (or None when the character/presets are unconfigured). Recomputed from
    current overrides; never re-runs the model.
    """
    threshold = config.settings.emotion_threshold
    mappers: dict[str, object] = {}
    for idx, a in list(analysis.items()):
        char_name = a.get("character_name")
        char_config = config.characters.get(char_name)
        presets = _state["presets"].get(char_name)
        psd = _get_psd_for(char_name, char_config)
        presets_like = psd if psd is not None else presets
        if char_config is None or presets_like is None:
            a["resolution"] = None
            continue
        mapper = mappers.get(char_name)
        if mapper is None:
            mapper = ExpressionMapper(
                char_config, presets_like,
                weak_max=config.settings.intensity_weak_max,
                strong_min=config.settings.intensity_strong_min,
            )
            mappers[char_name] = mapper
        override = overrides.get(int(idx)) if str(idx).isdigit() else None
        override = override or overrides.get(str(idx)) or overrides.get(idx)
        try:
            slot_key, preset_name, source, _parts = _resolve_voice(
                mapper, char_config, presets, a, override, threshold, psd
            )
            a["resolution"] = {
                "slot_key": slot_key,
                "preset_name": preset_name,
                "source": source,
            }
            a["guide"] = _build_guide(mapper, char_config, a, override, threshold)
        except Exception:
            a["resolution"] = None
            a["guide"] = None


def _get_or_create_analyzer(model_type: str, settings: Settings):
    current = _state.get("analyzer")
    if current is not None:
        return current

    if model_type == "local":
        from .emotion.bert_analyzer import BertEmotionAnalyzer
        analyzer = BertEmotionAnalyzer(settings.model_path, reader_weight=settings.reader_weight)
    elif model_type in ("llm_claude", "llm_openai", "llm_deepseek"):
        from .emotion.llm_analyzer import LlmEmotionAnalyzer
        provider = {"llm_claude": "claude", "llm_openai": "openai", "llm_deepseek": "deepseek"}[model_type]
        analyzer = LlmEmotionAnalyzer(
            provider=provider,
            api_key=settings.llm_api_key or None,
            model=settings.llm_model or None,
        )
    else:
        raise HTTPException(400, f"Unknown model type: {model_type}")

    _state["analyzer"] = analyzer
    return analyzer


def _compute_all_placements(
    project: YmmpProject,
    config: ProjectConfig,
    analysis: dict,
    timeline_index: int,
) -> list[FacePlacement]:
    voices = project.get_voice_items(timeline_index)
    char_voices: dict[str, list[VoiceItem]] = {}
    for v in voices:
        char_voices.setdefault(v.character_name, []).append(v)

    # 立ち絵(TachieItem)の存在区間。表情アイテムの延長をこの区間にクリップする。
    tachie_map = project.get_tachie_intervals(timeline_index)

    # 「前回の表情を保つ＋持続ターン数」の打ち切り終端を全キャラ横断の台詞順から
    # 事前計算する（per-char の timing_engine は他キャラの台詞位置を知らないため）。
    overrides_all: dict = _state.get("overrides", {})
    global_sorted = sorted(voices, key=lambda v: v.frame)
    hold_end_frames: dict[int, int] = {}
    for i, v in enumerate(global_sorted):
        ov = overrides_all.get(v.index) or overrides_all.get(str(v.index))
        if not (ov and ov.get("hold_previous")):
            continue
        try:
            n_turns = int(ov.get("hold_turns") or 0)
        except (TypeError, ValueError):
            n_turns = 0
        if n_turns <= 0:
            continue  # 0=従来挙動（自キャラの次台詞まで）
        turns = 0
        for nxt in global_sorted[i + 1:]:
            if nxt.character_name == v.character_name:
                break  # 自キャラの次台詞が優先。打ち切りせず従来挙動（entryなし）
            turns += 1
            if turns >= n_turns:
                hold_end_frames[v.index] = nxt.frame + nxt.length  # N本目(別キャラ)の終端
                break

    all_placements: list[FacePlacement] = []
    for char_name, char_voice_list in char_voices.items():
        char_config = config.characters.get(char_name)
        presets: PresetCollection | None = _state["presets"].get(char_name)
        psd = _get_psd_for(char_name, char_config)
        presets_like = psd if psd is not None else presets
        if char_config is None or presets_like is None:
            continue

        mapper = ExpressionMapper(
            char_config, presets_like,
            weak_max=config.settings.intensity_weak_max,
            strong_min=config.settings.intensity_strong_min,
        )
        threshold = config.settings.emotion_threshold

        overrides: dict = _state.get("overrides", {})
        emotion_results: dict[int, tuple[str, dict[str, str | None]]] = {}
        hold_indices: set[int] = set()
        for v in char_voice_list:
            a = analysis.get(str(v.index)) or analysis.get(v.index)
            if a is None:
                continue

            override = overrides.get(v.index) or overrides.get(str(v.index))
            if override and override.get("hold_previous"):
                # "前回の表情を保つ": timing_engine extends the previous item over
                # this voice. Still resolve its own expression as a fallback for
                # when there is no previous item (e.g. the first voice).
                hold_indices.add(v.index)
            _slot, preset_name, _source, parts = _resolve_voice(
                mapper, char_config, presets, a, override, threshold, psd
            )
            emotion_results[v.index] = (preset_name, parts)

        placements = compute_face_placements(
            voice_items=char_voice_list,
            emotion_results=emotion_results,
            layer_offset=char_config.layer_offset,
            extend_expression=config.settings.extend_expression,
            max_gap_extend=config.settings.max_gap_extend,
            hold_indices=hold_indices,
            valid_intervals=tachie_map.get(char_name),
            hold_end_frames=hold_end_frames,
        )
        all_placements.extend(placements)

    all_placements.sort(key=lambda p: p.frame)
    return all_placements


def _config_to_dict(config: ProjectConfig) -> dict:
    return {
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
            "llm_model": config.settings.llm_model,
            "personalization_enabled": config.settings.personalization_enabled,
            "personalization_strength": config.settings.personalization_strength,
            "compound_auto_mirror": config.settings.compound_auto_mirror,
        },
        "characters": {
            name: {
                "preset_ini": c.preset_ini,
                "tachie_dir": c.tachie_dir,
                "tachie_type": c.tachie_type,
                "psd_path": c.psd_path,
                "layer_offset": c.layer_offset,
                "emotion_presets": c.emotion_presets,
                "emotion_intensity_presets": c.emotion_intensity_presets,
                "compound_presets_2": c.compound_presets_2,
                "compound_presets_3": c.compound_presets_3,
                "compound_max_score": c.compound_max_score,
                "emotion_parts": c.emotion_parts,
                "gradient_presets": c.gradient_presets,
                "persona_valence": c.persona_valence,
                "persona_arousal": c.persona_arousal,
                "persona_strength": c.persona_strength,
            }
            for name, c in config.characters.items()
        },
    }


def _build_config_from_dict(data: dict) -> ProjectConfig:
    settings_raw = data.get("settings", {})
    settings = Settings(
        emotion_model=settings_raw.get("emotion_model", "local"),
        model_path=settings_raw.get("model_path", DEFAULT_MODEL_PATH),
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
        llm_model=settings_raw.get("llm_model", ""),
        personalization_enabled=settings_raw.get("personalization_enabled", False),
        personalization_strength=settings_raw.get("personalization_strength", 0.5),
        compound_auto_mirror=settings_raw.get("compound_auto_mirror", True),
    )
    characters: dict[str, CharacterConfig] = {}
    for name, char_raw in data.get("characters", {}).items():
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


# --- Version check (GitHub の公開タグと比較) ---

GITHUB_TAGS_URL = "https://api.github.com/repos/bluemistel/YMM4EmotionMekerKIT/tags"
DOWNLOAD_URL = "https://bluemist.booth.pm/items/8466630"


def _parse_semver(name: str) -> tuple[int, ...] | None:
    """"v1.0.2" → (1,0,2)。純粋な数値ドット区切りのみ採用。"""
    s = (name or "").strip().lstrip("vV")
    parts = s.split(".")
    if not parts or not all(p.isdigit() for p in parts):
        return None
    return tuple(int(p) for p in parts)


@app.get("/api/version/latest")
def get_latest_version():
    """GitHub の公開タグから最新バージョンを取得して返す。

    フロントは自身のアプリバージョンと比較して更新有無を判定する。失敗しても
    アプリ動作には影響しないよう ok:false を返すだけにする（例外を投げない）。
    """
    import json as _json
    import urllib.request

    try:
        req = urllib.request.Request(
            GITHUB_TAGS_URL,
            headers={
                "User-Agent": "YMM4EmotionMakerKIT",
                "Accept": "application/vnd.github+json",
            },
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        versions: list[tuple[int, ...]] = []
        for t in data if isinstance(data, list) else []:
            v = _parse_semver(t.get("name", ""))
            if v is not None:
                versions.append(v)
        if not versions:
            return {"ok": False, "download_url": DOWNLOAD_URL}
        latest = max(versions)
        return {
            "ok": True,
            "latest": ".".join(str(x) for x in latest),
            "download_url": DOWNLOAD_URL,
        }
    except Exception as e:  # ネットワーク不通・レート制限などは握りつぶす
        logger.info("version check failed: %s", e)
        return {"ok": False, "download_url": DOWNLOAD_URL, "error": str(e)}


# --- Server control ---

@app.post("/api/server/shutdown")
def shutdown_server():
    logger.info("Shutdown requested via API")
    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "shutting_down"}
