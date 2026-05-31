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
    CharacterConfig,
    ProjectConfig,
    Settings,
    auto_load_config,
    auto_save_config,
    generate_template_config,
    load_config,
    save_config,
)
from .expression_mapper import ExpressionMapper
from .face_item_builder import build_tachie_face_item
from .grouping import (
    DialogueGroup,
    build_group_contexts,
    detect_groups,
    merge_groups,
    split_group,
)
from .preset_loader import (
    FIELD_TO_SUBDIR,
    RENDER_ORDER,
    PresetCollection,
    load_preset_ini,
    resolve_part_path,
)
from .ymm4_settings import get_default_tachie_parts
from .timing_engine import FacePlacement, compute_face_placements
from .ymmp_parser import CharacterInfo, VoiceItem, YmmpProject

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
    "analyzer": None,
    "analysis_results": {},
    "placements": {},
    "groups": [],
    "overrides": {},
}


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

class WorkstateSaveRequest(BaseModel):
    path: str

class WorkstateLoadRequest(BaseModel):
    path: str
    timeline_index: int = 0


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
            {"name": c.name, "tachie_directory": c.tachie_directory, "voice_layer": c.voice_layer, "color": c.color}
            for c in characters
        ],
        "voice_count": len(voices),
        "video_info": video_info,
        "timeline_count": len(project.timelines),
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
            {"name": c.name, "tachie_directory": c.tachie_directory, "voice_layer": c.voice_layer, "color": c.color}
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
    for c in characters:
        if c.name in voice_names and c.tachie_directory:
            tachie_dirs[c.name] = c.tachie_directory
            ini_path = Path(c.tachie_directory) / "preset.ini"
            if ini_path.exists():
                col = load_preset_ini(ini_path, c.tachie_directory)
                preset_names_per_char[c.name] = col.get_preset_names()
                _state["presets"][c.name] = col

    template = generate_template_config(voice_names, preset_names_per_char, tachie_dirs)

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
                tmpl_char.compound_presets_2 = saved_char.compound_presets_2
                tmpl_char.compound_presets_3 = saved_char.compound_presets_3
                tmpl_char.compound_max_score = saved_char.compound_max_score
                tmpl_char.emotion_parts = saved_char.emotion_parts
                tmpl_char.layer_offset = saved_char.layer_offset

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
    config.characters[req.character_name] = CharacterConfig(
        preset_ini=char_data.get("preset_ini", ""),
        tachie_dir=char_data.get("tachie_dir", ""),
        layer_offset=char_data.get("layer_offset", 1),
        emotion_presets=char_data.get("emotion_presets", {}),
        compound_presets_2=cp2,
        compound_presets_3=char_data.get("compound_presets_3", {}),
        compound_max_score=char_data.get("compound_max_score", 0.65),
        emotion_parts=char_data.get("emotion_parts", {}),
        gradient_presets=char_data.get("gradient_presets", {}),
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
    voices = project.get_voice_items()
    updated = merge_groups(groups, req.group_ids, voices)
    _state["groups"] = updated

    return {"count": len(updated)}


@app.post("/api/groups/split")
def split_dialogue_group(req: SplitGroupRequest):
    project: YmmpProject | None = _state["project"]
    if project is None:
        raise HTTPException(400, "No project loaded")

    groups: list[DialogueGroup] = _state.get("groups", [])
    voices = project.get_voice_items()
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
    }
    return {"status": "set", "voice_index": voice_index}


@app.delete("/api/override/{voice_index}")
def delete_override(voice_index: int):
    _state["overrides"].pop(voice_index, None)
    return {"status": "deleted", "voice_index": voice_index}


@app.get("/api/overrides")
def get_overrides():
    return {"overrides": _state.get("overrides", {})}


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

    voices = project.get_voice_items(req.timeline_index)
    texts = [v.serif for v in voices]

    # Build contexts from groups if available, otherwise use sliding window
    groups: list[DialogueGroup] = _state.get("groups", [])
    contexts: list[list[str]] = []

    if groups:
        group_ctx = build_group_contexts(groups)
        for v in voices:
            ctx_text = group_ctx.get(v.index, "")
            contexts.append([ctx_text] if ctx_text else [])
    else:
        window = config.settings.context_window
        for i in range(len(voices)):
            start = max(0, i - window)
            ctx = [voices[j].serif for j in range(start, i)]
            contexts.append(ctx)

    results = analyzer.analyze_batch(texts, contexts)

    post_map = None
    if config.settings.postprocess_enabled:
        from .emotion_postprocess import apply_postprocessing
        raw_map = {v.index: e for v, e in zip(voices, results)}
        post_map = apply_postprocessing(voices, raw_map, config.settings)

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
            }

    _resolve_for_analysis(config, analysis, _state.get("overrides", {}))
    _state["analysis_results"] = analysis
    return {"count": len(analysis), "results": analysis}


@app.get("/api/analyze/result")
def get_analysis_result():
    analysis = _state.get("analysis_results", {})
    config: ProjectConfig | None = _state["config"]
    if analysis and config is not None:
        _resolve_for_analysis(config, analysis, _state.get("overrides", {}))
    return {"results": analysis}


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

    all_placements = _compute_all_placements(project, config, analysis, req.timeline_index)

    face_items = []
    for p in all_placements:
        char_config = config.characters.get(p.character_name, CharacterConfig())
        layer = p.voice_layer + char_config.layer_offset
        item = build_tachie_face_item(
            character_name=p.character_name,
            frame=p.frame,
            length=p.length,
            layer=layer,
            parts=p.parts,
            remark=f"[Auto] {p.preset_name}",
        )
        face_items.append(item)

    project.insert_face_items(face_items, req.timeline_index)

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
        "face_items_count": len(face_items),
    }


# --- Helpers ---

def _resolve_voice(mapper, char_config, presets, a: dict, override: dict | None, threshold: float):
    """Single source of truth for per-voice expression resolution.

    Returns (slot_key, preset_name, source, parts) where source is one of
    "override" | "gradient" | "mapping". Mirrors the precedence in
    _compute_all_placements exactly so the analyze view and preview/execute
    never drift.
    """
    if override and override.get("preset_name"):
        preset_name = override["preset_name"]
        parts = presets.resolve_face_params(preset_name)
        part_overrides = override.get("part_overrides") or {}
        if part_overrides:
            from .preset_loader import resolve_part_path
            for field_name, val in part_overrides.items():
                if not val:
                    # Empty value = clear this part
                    parts[field_name] = None
                elif "\\" in val or "/" in val:
                    # Caller passed a full path already
                    parts[field_name] = val
                else:
                    # Caller passed a bare filename — resolve against the
                    # character's tachie directory (numbered subdir first)
                    parts[field_name] = resolve_part_path(presets.directory, field_name, val)
        return ("override", preset_name, "override", parts)

    from .emotion.base import EmotionResult
    emotion = EmotionResult(**a["emotion"])
    slot_key, preset_name = mapper.resolve_slot(emotion, threshold)
    source = "mapping"

    if a.get("gradient") and a["gradient"].get("type"):
        from .emotion_postprocess import resolve_gradient_preset
        gtype = a["gradient"]["type"]
        gvalues = a["gradient"]["values"]
        gp = resolve_gradient_preset(gvalues, gtype, char_config.gradient_presets)
        if gp and gp in presets.presets:
            preset_name = gp
            source = "gradient"
            if gvalues:
                dominant = max(gvalues, key=lambda k: abs(gvalues[k]))
                slot_key = f"gradient_{gtype}:{dominant}"
            else:
                slot_key = f"gradient_{gtype}:"

    parts = mapper.resolve_parts(emotion, threshold)
    return (slot_key, preset_name, source, parts)


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
        if char_config is None or presets is None:
            a["resolution"] = None
            continue
        mapper = mappers.get(char_name)
        if mapper is None:
            mapper = ExpressionMapper(char_config, presets)
            mappers[char_name] = mapper
        override = overrides.get(int(idx)) if str(idx).isdigit() else None
        override = override or overrides.get(str(idx)) or overrides.get(idx)
        try:
            slot_key, preset_name, source, _parts = _resolve_voice(
                mapper, char_config, presets, a, override, threshold
            )
            a["resolution"] = {
                "slot_key": slot_key,
                "preset_name": preset_name,
                "source": source,
            }
        except Exception:
            a["resolution"] = None


def _get_or_create_analyzer(model_type: str, settings: Settings):
    current = _state.get("analyzer")
    if current is not None:
        return current

    if model_type == "local":
        from .emotion.bert_analyzer import BertEmotionAnalyzer
        analyzer = BertEmotionAnalyzer(settings.model_path)
    elif model_type in ("llm_claude", "llm_openai"):
        from .emotion.llm_analyzer import LlmEmotionAnalyzer
        provider = "claude" if model_type == "llm_claude" else "openai"
        analyzer = LlmEmotionAnalyzer(provider=provider, api_key=settings.llm_api_key or None)
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

    all_placements: list[FacePlacement] = []
    for char_name, char_voice_list in char_voices.items():
        char_config = config.characters.get(char_name)
        presets: PresetCollection | None = _state["presets"].get(char_name)
        if char_config is None or presets is None:
            continue

        mapper = ExpressionMapper(char_config, presets)
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
                mapper, char_config, presets, a, override, threshold
            )
            emotion_results[v.index] = (preset_name, parts)

        placements = compute_face_placements(
            voice_items=char_voice_list,
            emotion_results=emotion_results,
            layer_offset=char_config.layer_offset,
            extend_expression=config.settings.extend_expression,
            max_gap_extend=config.settings.max_gap_extend,
            hold_indices=hold_indices,
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
            "extend_expression": config.settings.extend_expression,
            "max_gap_extend": config.settings.max_gap_extend,
            "postprocess_enabled": config.settings.postprocess_enabled,
            "decay_rate": config.settings.decay_rate,
            "gradient_sudden_threshold": config.settings.gradient_sudden_threshold,
            "gradient_gradual_window": config.settings.gradient_gradual_window,
            "gradient_gradual_max_delta": config.settings.gradient_gradual_max_delta,
            "ymm4_exe_path": config.settings.ymm4_exe_path,
            "llm_api_key": config.settings.llm_api_key,
        },
        "characters": {
            name: {
                "preset_ini": c.preset_ini,
                "tachie_dir": c.tachie_dir,
                "layer_offset": c.layer_offset,
                "emotion_presets": c.emotion_presets,
                "compound_presets_2": c.compound_presets_2,
                "compound_presets_3": c.compound_presets_3,
                "compound_max_score": c.compound_max_score,
                "emotion_parts": c.emotion_parts,
                "gradient_presets": c.gradient_presets,
            }
            for name, c in config.characters.items()
        },
    }


def _build_config_from_dict(data: dict) -> ProjectConfig:
    settings_raw = data.get("settings", {})
    settings = Settings(
        emotion_model=settings_raw.get("emotion_model", "local"),
        model_path=settings_raw.get("model_path", "models/wrime-roberta"),
        emotion_threshold=settings_raw.get("emotion_threshold", 0.3),
        context_window=settings_raw.get("context_window", 3),
        extend_expression=settings_raw.get("extend_expression", True),
        max_gap_extend=settings_raw.get("max_gap_extend", 300),
        postprocess_enabled=settings_raw.get("postprocess_enabled", False),
        decay_rate=settings_raw.get("decay_rate", 0.0),
        gradient_sudden_threshold=settings_raw.get("gradient_sudden_threshold", 0.4),
        gradient_gradual_window=settings_raw.get("gradient_gradual_window", 3),
        gradient_gradual_max_delta=settings_raw.get("gradient_gradual_max_delta", 0.15),
        ymm4_exe_path=settings_raw.get("ymm4_exe_path", ""),
        llm_api_key=settings_raw.get("llm_api_key", ""),
    )
    characters: dict[str, CharacterConfig] = {}
    for name, char_raw in data.get("characters", {}).items():
        cp2 = char_raw.get("compound_presets_2", char_raw.get("compound_presets", {}))
        characters[name] = CharacterConfig(
            preset_ini=char_raw.get("preset_ini", ""),
            tachie_dir=char_raw.get("tachie_dir", ""),
            layer_offset=char_raw.get("layer_offset", 1),
            emotion_presets=char_raw.get("emotion_presets", {}),
            compound_presets_2=cp2,
            compound_presets_3=char_raw.get("compound_presets_3", {}),
            compound_max_score=char_raw.get("compound_max_score", 0.65),
            emotion_parts=char_raw.get("emotion_parts", {}),
            gradient_presets=char_raw.get("gradient_presets", {}),
        )
    return ProjectConfig(settings=settings, characters=characters)


# --- Server control ---

@app.post("/api/server/shutdown")
def shutdown_server():
    logger.info("Shutdown requested via API")
    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "shutting_down"}
