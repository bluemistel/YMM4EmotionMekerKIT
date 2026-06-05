from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from .text_normalize import normalize_serif


VOICE_ITEM_TYPE = "YukkuriMovieMaker.Project.Items.VoiceItem, YukkuriMovieMaker"
TACHIE_FACE_ITEM_TYPE = "YukkuriMovieMaker.Project.Items.TachieFaceItem, YukkuriMovieMaker"
TACHIE_ITEM_TYPE = "YukkuriMovieMaker.Project.Items.TachieItem, YukkuriMovieMaker"


@dataclass
class VoiceItem:
    character_name: str
    serif: str
    frame: int
    length: int
    layer: int
    index: int
    raw: dict = field(repr=False)


@dataclass
class CharacterInfo:
    name: str
    tachie_directory: str | None = None
    voice_layer: int | None = None
    color: str | None = None
    # 立ち絵の規格: "png"（パーツ画像立ち絵）または "psd"（PSD立ち絵）。
    tachie_type: str = "png"
    # PSD立ち絵のときの .psd ファイルパス。
    psd_path: str | None = None


class YmmpProject:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._data: dict | None = None

    def load(self) -> None:
        with open(self.path, "r", encoding="utf-8-sig") as f:
            self._data = json.load(f)

    @property
    def data(self) -> dict:
        if self._data is None:
            raise RuntimeError("Project not loaded. Call load() first.")
        return self._data

    @property
    def timelines(self) -> list[dict]:
        tls = self.data.get("Timelines")
        if tls is not None:
            return tls
        tl = self.data.get("Timeline")
        if isinstance(tl, dict):
            return [tl]
        return []

    def get_items(self, timeline_index: int = 0) -> list[dict]:
        if timeline_index >= len(self.timelines):
            raise IndexError(f"Timeline index {timeline_index} out of range")
        return self.timelines[timeline_index].get("Items", [])

    def get_voice_items(self, timeline_index: int = 0) -> list[VoiceItem]:
        items = self.get_items(timeline_index)
        voices = []
        for i, item in enumerate(items):
            if item.get("$type") == VOICE_ITEM_TYPE:
                voices.append(VoiceItem(
                    character_name=item["CharacterName"],
                    # YMM4 制御タグ（色/サイズ/ルビ等）を除去したクリーンテキストにする。
                    # 解析・埋め込み・辞書一致・学習ラベル・表示が全て同一テキストになる。
                    # serif は .ymmp に書き戻さないため安全。
                    serif=normalize_serif(item.get("Serif", "")),
                    frame=item["Frame"],
                    length=item["Length"],
                    layer=item["Layer"],
                    index=i,
                    raw=item,
                ))
        voices.sort(key=lambda v: v.frame)
        return voices

    def get_tachie_intervals(self, timeline_index: int = 0) -> dict[str, list[tuple[int, int]]]:
        """キャラ名 -> 立ち絵(TachieItem)の存在区間 [start, end) のマージ済みリスト。

        表情アイテムは同キャラの立ち絵が同区間に存在しないと意味を成さないため、
        延長を立ち絵区間にクリップする用途で使う。YMM4 のグループ化された立ち絵も
        フラットな Items[] に残るため、タイムライン直下の走査で網羅できる。
        """
        items = self.get_items(timeline_index)
        by_char: dict[str, list[tuple[int, int]]] = {}
        for item in items:
            if item.get("$type") != TACHIE_ITEM_TYPE:
                continue
            name = item.get("CharacterName")
            if not name:
                continue
            frame = item.get("Frame")
            length = item.get("Length")
            if frame is None or length is None:
                continue
            by_char.setdefault(name, []).append((int(frame), int(frame) + int(length)))

        # 各キャラの区間を昇順マージ（重なり/隣接を結合）。
        merged: dict[str, list[tuple[int, int]]] = {}
        for name, intervals in by_char.items():
            intervals.sort()
            out: list[tuple[int, int]] = []
            for start, end in intervals:
                if out and start <= out[-1][1]:
                    out[-1] = (out[-1][0], max(out[-1][1], end))
                else:
                    out.append((start, end))
            merged[name] = out
        return merged

    def get_characters(self) -> list[CharacterInfo]:
        characters = []
        for char in self.data.get("Characters", []):
            tachie_dir = None
            tachie_type = "png"
            psd_path = None
            tcp = char.get("TachieCharacterParameter")
            if tcp:
                ttype = tcp.get("$type", "")
                if "Psd" in ttype:
                    # PSD立ち絵: ディレクトリではなく単一の .psd ファイルを参照する。
                    tachie_type = "psd"
                    psd_path = tcp.get("FilePath")
                else:
                    tachie_dir = tcp.get("Directory")
            color = self._parse_argb_color(char.get("Color"))
            characters.append(CharacterInfo(
                name=char["Name"],
                tachie_directory=tachie_dir,
                voice_layer=char.get("Layer"),
                color=color,
                tachie_type=tachie_type,
                psd_path=psd_path,
            ))
        return characters

    @staticmethod
    def _parse_argb_color(argb: str | None) -> str | None:
        if not argb or not argb.startswith("#") or len(argb) != 9:
            return None
        a, r, g, b = argb[1:3], argb[3:5], argb[5:7], argb[7:9]
        alpha = int(a, 16) / 255
        if alpha >= 0.99:
            return f"#{r}{g}{b}"
        return f"rgba({int(r, 16)},{int(g, 16)},{int(b, 16)},{alpha:.2f})"

    def get_character_names_from_voices(self, timeline_index: int = 0) -> list[str]:
        voices = self.get_voice_items(timeline_index)
        seen = set()
        names = []
        for v in voices:
            if v.character_name not in seen:
                seen.add(v.character_name)
                names.append(v.character_name)
        return names

    def remove_face_items(self, character_names: set[str], timeline_index: int = 0) -> int:
        """指定キャラの既存表情アイテム(TachieFaceItem)をタイムラインから削除する。

        YMM4 は同じ区間に複数の表情アイテムがあっても最下部の1つしか適用しないため、
        書き出し前に対象キャラの既存表情アイテムを除去してから新しいものを入れることで、
        重複（古い手動配置や前回の書き出し結果）による誤適用を防ぐ。
        削除した件数を返す。
        """
        if not character_names:
            return 0
        tl = self.timelines[timeline_index]
        items = tl.get("Items", [])
        kept = [
            it for it in items
            if not (
                it.get("$type") == TACHIE_FACE_ITEM_TYPE
                and it.get("CharacterName") in character_names
            )
        ]
        removed = len(items) - len(kept)
        tl["Items"] = kept
        return removed

    def insert_face_items(self, face_items: list[dict], timeline_index: int = 0) -> None:
        items = self.get_items(timeline_index)
        items.extend(face_items)

    def save(self, output_path: str | Path | None = None, backup: bool = True) -> Path:
        if output_path is None:
            output_path = self.path
        output_path = Path(output_path)

        if backup and output_path.exists():
            bak = output_path.with_suffix(output_path.suffix + ".bak")
            shutil.copy2(output_path, bak)

        with open(output_path, "w", encoding="utf-8-sig") as f:
            json.dump(self.data, f, ensure_ascii=False, separators=(",", ":"))

        return output_path

    def get_video_info(self, timeline_index: int = 0) -> dict:
        if timeline_index >= len(self.timelines):
            return {}
        return self.timelines[timeline_index].get("VideoInfo", {})

    def get_fps(self, timeline_index: int = 0) -> float:
        """タイムラインの FPS を返す。YMM4 の VideoInfo は整数キー "FPS"。

        プロジェクトごとに FPS が異なる（例: 30 / 60）ため、秒→フレーム換算に使う。
        取得できない場合は 60.0 にフォールバックし、必ず正の値を返す。
        """
        vi = self.get_video_info(timeline_index)
        for key in ("FPS", "Fps", "fps"):
            val = vi.get(key)
            if val is not None:
                try:
                    fps = float(val)
                    if fps > 0:
                        return fps
                except (TypeError, ValueError):
                    pass
        return 60.0
