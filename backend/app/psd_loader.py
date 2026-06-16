# SPDX-License-Identifier: AGPL-3.0-or-later
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

# レイヤー個別ベイク時のプレビュー最大辺（px）。これを超えるPSDは縮小してから書き出す。
# WebPは極小なので転送は軽い。ズーム余裕を見て大きめ。
PREVIEW_MAX_DIM = 1200

# psd-tools の BlendMode 名 → CSS mix-blend-mode キーワード。未対応は normal。
_BLEND_CSS = {
    "normal": "normal", "pass_through": "normal", "dissolve": "normal",
    "multiply": "multiply", "screen": "screen", "overlay": "overlay",
    "darken": "darken", "lighten": "lighten",
    "color_dodge": "color-dodge", "color_burn": "color-burn",
    "linear_dodge": "plus-lighter",
    "hard_light": "hard-light", "soft_light": "soft-light",
    "difference": "difference", "exclusion": "exclusion",
    "hue": "hue", "saturation": "saturation", "color": "color", "luminosity": "luminosity",
}


def _blend_to_css(bm) -> str:
    name = str(bm).split(".")[-1].lower()  # "BlendMode.MULTIPLY" -> "multiply"
    return _BLEND_CSS.get(name, "normal")


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
        # レイヤーID → 正準順序インデックス（ツリーDFSの上→下プリオーダー）。
        # YMM4 はプリセットの Layers をこの順で並べるため、保存時に必ずこの順へ整列する
        # （順序が違うと YMM4 がプリセットを認識できない）。
        self._order_index: dict[str, int] = {}
        self._psd = None  # lazy psd_tools.PSDImage
        self._render_lock = threading.Lock()
        # レイヤー識別スキーム: "i"=PSDのレイヤーID(lyid)由来 / "n"=生レコードの位置番号。
        # YMM4 はレイヤーに lyid が無い PSD では n<位置> で番号付けする。
        self._scheme: str = "i"
        self._rec_index: dict[int, int] = {}  # id(LayerRecord) -> 生レコードindex（nスキーム用）
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

    def _scheme_from_presets(self) -> str | None:
        """-ymm.json のプリセットID接頭辞から識別スキームを判定する（最優先・確実）。"""
        for layers in self.presets.values():
            for x in layers:
                if not x:
                    continue
                if x[0] == "n" and x[1:].isdigit():
                    return "n"
                if x[0] == "i":
                    return "i"
        return None

    def _node_id(self, layer) -> str | None:
        """psd-tools レイヤー → YMM4 のレイヤーID（"i<lyid>" or "n<位置>"）。

        n スキームの位置番号は YMM4 に一致させ、生レコードの 0 始まりインデックスを
        そのまま使う（rec[0]=最下部の境界レコード=n0 は未使用、rec[1] が n1 …）。
        """
        if self._scheme == "n":
            rec = getattr(layer, "_record", None)
            if rec is not None and id(rec) in self._rec_index:
                return f"n{self._rec_index[id(rec)]}"
            return None
        lid = getattr(layer, "layer_id", None)
        if lid is None or lid < 0:
            return None
        return f"{_ID_PREFIX}{lid}"

    def _build_tree(self) -> None:
        psd = self._get_psd()

        # 生レコードの位置→index（n スキームの番号付けに使う。グループ境界の
        # 隠しレコードも含むため YMM4 の n<位置> と一致する）。
        try:
            recs = psd._record.layer_and_mask_information.layer_info.layer_records
            self._rec_index = {id(r): i for i, r in enumerate(recs)}
        except Exception:
            self._rec_index = {}

        # スキーム決定: プリセット接頭辞が最優先。無ければ PSD の実ID有無で推測。
        scheme = self._scheme_from_presets()
        if scheme is None:
            has_real = any(
                getattr(l, "layer_id", -1) not in (None, -1) for l in psd.descendants()
            )
            scheme = "i" if has_real else "n"
        self._scheme = scheme

        def build(group) -> list[PsdNode]:
            nodes: list[PsdNode] = []
            # psd-tools はストレージ順（下→上）で yield するため、
            # 視覚的な上→下に並べ替えて返す。
            for layer in reversed(list(group)):
                node_id = self._node_id(layer)
                if node_id is None:
                    continue
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

        # ツリーDFS（上→下プリオーダー）で正準順序を確定。YMM4 のプリセット Layers の
        # 並びと一致する（実機の -ymm.json で検証済み）。
        order: dict[str, int] = {}

        def index(nodes: list[PsdNode]) -> None:
            for n in nodes:
                if n.id not in order:
                    order[n.id] = len(order)
                index(n.children)

        index(self._tree)
        self._order_index = order

    def order_layers(self, ids) -> list[str]:
        """レイヤーID集合を YMM4 の正準順序（ツリーDFS上→下）へ整列して返す。

        未知ID（ツリーに無いもの）は末尾に自然順で付ける（堅牢性のため）。
        重複は除去する。
        """
        seen: set[str] = set()
        uniq: list[str] = []
        for x in ids:
            sx = str(x)
            if sx not in seen:
                seen.add(sx)
                uniq.append(sx)
        known = [x for x in uniq if x in self._order_index]
        unknown = [x for x in uniq if x not in self._order_index]
        known.sort(key=lambda x: self._order_index[x])
        unknown.sort(key=_natural_key)
        return known + unknown

    # ---- psd_tools ハンドル -----------------------------------------------
    def _get_psd(self):
        if self._psd is None:
            from psd_tools import PSDImage
            self._psd = PSDImage.open(self.psd_path)
        return self._psd

    # ---- 公開 API ----------------------------------------------------------
    def get_preset_names(self) -> list[str]:
        return sorted(self.presets.keys(), key=_natural_key)

    def append_preset(self, name: str, layers: list[str]) -> None:
        """-ymm.json の Presets 末尾に新プリセット {Name, Layers} を追記する。

        他のフィールド（MouthAnimations 等）は保持。YMM4 と同じく末尾に追加する。
        書き込み後は再読込（reload_psd_tachie）でアプリへ反映する想定。
        """
        name = (name or "").strip()
        if not name:
            raise ValueError("プリセット名が空です")
        p = self._ymm_json_path()
        data: dict = {}
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8-sig") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                data = {}
        if not isinstance(data, dict):
            data = {}
        presets = data.get("Presets")
        if not isinstance(presets, list):
            presets = []
        # YMM4 はプリセットの Layers をツリーDFS（上→下）の正準順序で並べる。
        # 順序が違うと YMM4 側で認識できないため、書き込み前に必ず整列する。
        presets.append({"Name": name, "Layers": self.order_layers(layers)})
        data["Presets"] = presets
        # 既存になければ空配列を補完（YMM4 の標準フィールド）。
        for k in ("MouthAnimations", "MouthVowelAnimations", "EyeAnimations"):
            data.setdefault(k, [])
        with open(p, "w", encoding="utf-8-sig") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

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
        # 末尾の版番号は、レイヤーID付与/合成ロジック変更時に旧キャッシュを失効させる。
        safe = hashlib.sha1(str(self.psd_path).encode("utf-8")).hexdigest()[:12]
        d = get_data_dir() / "psd_cache" / f"{safe}_{mtime}_v2"
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
                    nid = self._node_id(layer)
                    # フォルダもレイヤーも「自分の id が enable にあるか」で可視を決める。
                    # フォルダが非可視なら psd-tools の合成で子も自動的に隠れる（フォルダ継承）。
                    layer.visible = (nid in enable)
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

    # ---- 高速プレビュー: レイヤー個別ベイク ＋ 集合解決 -------------------
    def resolve_only(self, preset_name: str | None, overrides: dict[str, bool] | None) -> dict:
        """合成せずに、プリセット基準＋デルタの可視レイヤー集合だけ返す（軽量）。"""
        base = self.resolve_layers(preset_name)
        enable = set(base)
        for lid, on in (overrides or {}).items():
            if on:
                enable.add(lid)
            else:
                enable.discard(lid)
        return {"base_layers": base, "enable_layers": sorted(enable)}

    def bake_layers(self, scale: float | None = None) -> dict:
        """各リーフレイヤーを透明WebPとして書き出し、マニフェストを返す（ディスクキャッシュ）。

        フロントは各画像を CSS で重ね、表示/非表示の切替をクライアント側だけで行える
        （バックエンド往復なし＝瞬時）。psd-tools の composite() は一部PSDで空になるため、
        生ラスタの topil() を使う（不透明度/ブレンドは CSS 側で適用）。
        """
        from PIL import Image  # noqa: F401  (PIL 必須確認)

        psd = self._get_psd()
        cw, ch = psd.size
        if scale is None or scale <= 0:
            longest = max(cw, ch, 1)
            scale = min(1.0, PREVIEW_MAX_DIM / longest)

        cache = self._cache_dir() / f"layers_{scale:.4f}"
        manifest_path = cache / "manifest.json"
        if manifest_path.exists():
            try:
                return json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        with self._render_lock:
            if manifest_path.exists():
                try:
                    return json.loads(manifest_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
            cache.mkdir(parents=True, exist_ok=True)

            # 描画順 = 生レコード位置の昇順（下→上）。source-over で重ねるとフル合成に一致。
            leaves = [l for l in psd.descendants() if not l.is_group()]
            leaves.sort(key=lambda l: self._rec_index.get(id(getattr(l, "_record", None)), 0))

            out_layers: list[dict] = []
            seen: set[str] = set()
            for layer in leaves:
                nid = self._node_id(layer)
                if nid is None or nid in seen:
                    continue
                try:
                    img = layer.topil()
                except Exception:
                    img = None
                if img is None:
                    continue
                if img.mode != "RGBA":
                    img = img.convert("RGBA")
                left, top = layer.offset
                if scale < 0.999:
                    nw = max(1, round(img.size[0] * scale))
                    nh = max(1, round(img.size[1] * scale))
                    img = img.resize((nw, nh))
                fname = f"{nid}.webp"
                img.save(cache / fname, "WEBP", quality=88, method=4)
                seen.add(nid)
                out_layers.append({
                    "id": nid,
                    "name": str(layer.name),
                    "left": round(left * scale, 2),
                    "top": round(top * scale, 2),
                    "width": img.size[0],
                    "height": img.size[1],
                    "blend": _blend_to_css(getattr(layer, "blend_mode", None)),
                    "opacity": round((getattr(layer, "opacity", 255) or 255) / 255.0, 4),
                    "path": str(cache / fname),
                })

            manifest = {
                "canvas": {"w": round(cw * scale), "h": round(ch * scale), "scale": scale},
                "scheme": self._scheme,
                "layers": out_layers,
            }
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            return manifest


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


def reload_psd_tachie(psd_path: str | Path) -> PsdTachie:
    """-ymm.json を外部更新した後など、キャッシュを破棄して PsdTachie を作り直す。

    _CACHE のキーは PSD の mtime（-ymm.json 変更では変わらない）ため、当該パスの
    キャッシュ entry を全て捨ててから新規生成する。
    """
    p = Path(psd_path)
    sp = str(p)
    with _CACHE_LOCK:
        for k in [k for k in _CACHE if k[0] == sp]:
            _CACHE.pop(k, None)
        inst = PsdTachie(p)
        try:
            mtime = int(p.stat().st_mtime)
        except OSError:
            mtime = 0
        _CACHE[(sp, mtime)] = inst
        return inst
