from __future__ import annotations

import hashlib
import json
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

from .config import get_data_dir

# YMM4 の PSD立ち絵レイヤーIDは "i" + PSDレイヤーの lyid（タグブロック）。
# フォルダ(グループ)も lyid を持ち、EnableLayers に含まれる。
_ID_PREFIX = "i"


def _natural_key(s: str):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", s)]


@dataclass
class PsdNode:
    """PSDレイヤーツリーの1ノード（フロントのレイヤーパネル用）。"""

    id: str            # "iNNN"
    name: str
    is_folder: bool
    base_visible: bool  # PSD に保存されている既定の可視状態
    children: list["PsdNode"] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "is_folder": self.is_folder,
            "base_visible": self.base_visible,
            "children": [c.to_dict() for c in self.children],
        }


class PsdTachie:
    """1つの PSD立ち絵（.psd ＋ 同梱 -ymm.json）を表す。

    - presets: プリセット名 → 可視レイヤーID集合（-ymm.json の Presets）
    - tree: PSD のレイヤーツリー（描画順=上→下）
    - render(): 指定の可視レイヤー集合で合成し PNG をディスクキャッシュして返す
    """

    def __init__(self, psd_path: Path):
        self.psd_path = Path(psd_path)
        self.presets: dict[str, list[str]] = {}
        self.mouth_anim_groups: list[list[str]] = []
        self.eye_anim_groups: list[list[str]] = []
        self._tree: list[PsdNode] = []
        self._all_ids: set[str] = set()
        self._psd = None  # lazy psd_tools.PSDImage
        self._render_lock = threading.Lock()
        self._load_ymm_json()
        self._build_tree()

    # ---- 読み込み ---------------------------------------------------------
    def _ymm_json_path(self) -> Path:
        # "<stem>-ymm.json" が PSD と同じ階層にある。
        return self.psd_path.with_name(self.psd_path.stem + "-ymm.json")

    def _load_ymm_json(self) -> None:
        p = self._ymm_json_path()
        if not p.exists():
            return
        try:
            with open(p, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            return
        for preset in data.get("Presets", []) or []:
            name = preset.get("Name")
            layers = preset.get("Layers")
            if name and isinstance(layers, list):
                self.presets[name] = [str(x) for x in layers]
        self.mouth_anim_groups = [
            [str(x) for x in g.get("Layers", [])]
            for g in (data.get("MouthAnimations") or [])
        ]
        self.eye_anim_groups = [
            [str(x) for x in g.get("Layers", [])]
            for g in (data.get("EyeAnimations") or [])
        ]

    def _build_tree(self) -> None:
        psd = self._get_psd()

        def build(group) -> list[PsdNode]:
            nodes: list[PsdNode] = []
            # psd-tools はストレージ順（下→上）で yield するため、
            # 視覚的な上→下に並べ替えて返す。
            for layer in reversed(list(group)):
                lid = getattr(layer, "layer_id", None)
                if lid is None:
                    continue
                node_id = f"{_ID_PREFIX}{lid}"
                self._all_ids.add(node_id)
                is_folder = layer.is_group()
                node = PsdNode(
                    id=node_id,
                    name=str(layer.name),
                    is_folder=is_folder,
                    base_visible=bool(layer.visible),
                    children=build(layer) if is_folder else [],
                )
                nodes.append(node)
            return nodes

        self._tree = build(psd)

    # ---- psd_tools ハンドル -----------------------------------------------
    def _get_psd(self):
        if self._psd is None:
            from psd_tools import PSDImage
            self._psd = PSDImage.open(self.psd_path)
        return self._psd

    # ---- 公開 API ----------------------------------------------------------
    def get_preset_names(self) -> list[str]:
        return sorted(self.presets.keys(), key=_natural_key)

    def layer_tree(self) -> list[dict]:
        return [n.to_dict() for n in self._tree]

    def all_layer_ids(self) -> set[str]:
        return set(self._all_ids)

    def base_enable_layers(self) -> list[str]:
        """PSD 既定の可視レイヤー集合（プリセット未解決時のフォールバック）。"""
        out: list[str] = []

        def walk(nodes: list[PsdNode]) -> None:
            for n in nodes:
                if n.base_visible:
                    out.append(n.id)
                walk(n.children)

        walk(self._tree)
        return out

    def resolve_layers(self, preset_name: str | None) -> list[str]:
        """プリセット名 → 可視レイヤーIDリスト。未登録なら PSD 既定。"""
        if preset_name and preset_name in self.presets:
            # 存在するIDのみ採用（PSD とプリセットの不整合に頑健）。
            return [lid for lid in self.presets[preset_name] if lid in self._all_ids]
        return self.base_enable_layers()

    # ---- 合成（レンダリング） ---------------------------------------------
    def _cache_dir(self) -> Path:
        try:
            mtime = int(self.psd_path.stat().st_mtime)
        except OSError:
            mtime = 0
        # PSD のステム＋mtime でディレクトリを分け、PSD 更新でキャッシュ無効化。
        safe = hashlib.sha1(str(self.psd_path).encode("utf-8")).hexdigest()[:12]
        d = get_data_dir() / "psd_cache" / f"{safe}_{mtime}"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def render(self, enable_layers: set[str] | list[str]) -> Path:
        """可視レイヤー集合で PSD を合成し PNG パスを返す（ディスクキャッシュ）。

        合成規則: 各レイヤーは「自分の id が enable にあり、かつ全祖先フォルダの
        id も enable にある」ときのみ可視（psd-tools の group.visible 連鎖で自然に成立）。
        """
        enable = set(enable_layers)
        digest = hashlib.sha1(
            ",".join(sorted(enable)).encode("utf-8")
        ).hexdigest()
        out = self._cache_dir() / f"{digest}.png"
        if out.exists():
            return out

        with self._render_lock:
            if out.exists():
                return out
            psd = self._get_psd()

            def apply(group) -> None:
                for layer in group:
                    lid = getattr(layer, "layer_id", None)
                    layer.visible = (f"{_ID_PREFIX}{lid}" in enable)
                    if layer.is_group():
                        apply(layer)

            apply(psd)
            img = psd.composite(force=True)
            if img is None:
                # 全レイヤー非表示など合成結果が空のとき、透明1pxを返す。
                from PIL import Image
                img = Image.new("RGBA", (max(1, psd.width), max(1, psd.height)), (0, 0, 0, 0))
            img.save(out)
        return out


# プロジェクト横断の軽量キャッシュ: (path, mtime) をキーに PsdTachie を保持。
_CACHE: dict[tuple[str, int], PsdTachie] = {}
_CACHE_LOCK = threading.Lock()


def load_psd_tachie(psd_path: str | Path) -> PsdTachie:
    p = Path(psd_path)
    try:
        mtime = int(p.stat().st_mtime)
    except OSError:
        mtime = 0
    key = (str(p), mtime)
    with _CACHE_LOCK:
        inst = _CACHE.get(key)
        if inst is None:
            inst = PsdTachie(p)
            _CACHE[key] = inst
        return inst
