from __future__ import annotations

from dataclasses import dataclass

from .ymmp_parser import VoiceItem


@dataclass
class FacePlacement:
    character_name: str
    frame: int
    length: int
    voice_layer: int
    preset_name: str
    parts: dict[str, str | None]
    source_serifs: list[str]


def compute_face_placements(
    voice_items: list[VoiceItem],
    emotion_results: dict[int, tuple[str, dict[str, str | None]]],
    layer_offset: int = 1,
    extend_expression: bool = True,
    max_gap_extend: int = 300,
    hold_indices: set[int] | None = None,
) -> list[FacePlacement]:
    """
    Compute TachieFaceItem placements from voice items and emotion analysis results.

    Args:
        voice_items: Sorted list of VoiceItem for a single character.
        emotion_results: Dict mapping voice_item index -> (preset_name, resolved_parts).
        layer_offset: Offset from VoiceItem layer to face item layer.
        extend_expression: Whether to extend face items across gaps.
        max_gap_extend: Maximum gap (in frames) to extend across.
        hold_indices: Voice indices flagged "前回の表情を保つ". For such a voice the
            previous (pending) face item is extended to cover it instead of placing a
            new item. If no previous item exists (e.g. the first voice), it falls back
            to placing its own expression normally.

    Returns:
        List of FacePlacement objects.
    """
    if not voice_items:
        return []

    hold_indices = hold_indices or set()
    sorted_voices = sorted(voice_items, key=lambda v: v.frame)
    placements: list[FacePlacement] = []
    pending: FacePlacement | None = None

    for voice in sorted_voices:
        # "前回の表情を保つ": extend the previous item over this voice and skip
        # placing a new one. With no previous item, fall through to normal handling.
        if voice.index in hold_indices and pending is not None:
            pending.length = voice.frame + voice.length - pending.frame
            pending.source_serifs.append(voice.serif)
            continue

        result = emotion_results.get(voice.index)
        if result is None:
            continue

        preset_name, parts = result

        # Merge into the previous item only when the *resolved parts* are
        # identical, not merely the preset name. Otherwise a per-line パーツ個別変更
        # (which keeps the same preset but changes e.g. Body/Eye) would be
        # swallowed by the previous item and silently dropped on execute.
        if pending is not None and pending.preset_name == preset_name and pending.parts == parts:
            # Same expression: extend pending to cover this voice item
            pending.length = voice.frame + voice.length - pending.frame
            pending.source_serifs.append(voice.serif)
        else:
            if pending is not None:
                if extend_expression:
                    gap = voice.frame - (pending.frame + pending.length)
                    if 0 < gap <= max_gap_extend:
                        # Extend pending to start of this voice item
                        pending.length = voice.frame - pending.frame
                placements.append(pending)

            pending = FacePlacement(
                character_name=voice.character_name,
                frame=voice.frame,
                length=voice.length,
                voice_layer=voice.layer,
                preset_name=preset_name,
                parts=parts,
                source_serifs=[voice.serif],
            )

    if pending is not None:
        placements.append(pending)

    return placements
