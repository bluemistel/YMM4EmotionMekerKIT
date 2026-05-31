from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path


VOICE_ITEM_TYPE = "YukkuriMovieMaker.Project.Items.VoiceItem, YukkuriMovieMaker"
TACHIE_FACE_ITEM_TYPE = "YukkuriMovieMaker.Project.Items.TachieFaceItem, YukkuriMovieMaker"


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
                    serif=item.get("Serif", ""),
                    frame=item["Frame"],
                    length=item["Length"],
                    layer=item["Layer"],
                    index=i,
                    raw=item,
                ))
        voices.sort(key=lambda v: v.frame)
        return voices

    def get_characters(self) -> list[CharacterInfo]:
        characters = []
        for char in self.data.get("Characters", []):
            tachie_dir = None
            tcp = char.get("TachieCharacterParameter")
            if tcp:
                tachie_dir = tcp.get("Directory")
            color = self._parse_argb_color(char.get("Color"))
            characters.append(CharacterInfo(
                name=char["Name"],
                tachie_directory=tachie_dir,
                voice_layer=char.get("Layer"),
                color=color,
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
