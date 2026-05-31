from __future__ import annotations

from dataclasses import dataclass, field

from .ymmp_parser import VoiceItem


@dataclass
class DialogueGroup:
    group_id: int
    voice_indices: list[int]
    start_frame: int
    end_frame: int
    context_text: str = ""
    auto_detected: bool = True


def detect_groups(
    voices: list[VoiceItem],
    gap_threshold: int = 1,
) -> list[DialogueGroup]:
    if not voices:
        return []

    sorted_voices = sorted(voices, key=lambda v: v.frame)
    groups: list[DialogueGroup] = []
    current_indices: list[int] = [sorted_voices[0].index]
    current_start = sorted_voices[0].frame
    current_end = sorted_voices[0].frame + sorted_voices[0].length

    for i in range(1, len(sorted_voices)):
        prev = sorted_voices[i - 1]
        curr = sorted_voices[i]
        prev_end = prev.frame + prev.length
        gap = curr.frame - prev_end

        if gap >= gap_threshold:
            serifs = [v.serif for v in sorted_voices if v.index in current_indices]
            groups.append(DialogueGroup(
                group_id=len(groups),
                voice_indices=current_indices,
                start_frame=current_start,
                end_frame=current_end,
                context_text=" ".join(serifs),
            ))
            current_indices = [curr.index]
            current_start = curr.frame
            current_end = curr.frame + curr.length
        else:
            current_indices.append(curr.index)
            current_end = max(current_end, curr.frame + curr.length)

    serifs = [v.serif for v in sorted_voices if v.index in current_indices]
    groups.append(DialogueGroup(
        group_id=len(groups),
        voice_indices=current_indices,
        start_frame=current_start,
        end_frame=current_end,
        context_text=" ".join(serifs),
    ))

    return groups


def merge_groups(
    groups: list[DialogueGroup],
    group_ids: list[int],
    voices: list[VoiceItem],
) -> list[DialogueGroup]:
    if len(group_ids) < 2:
        return groups

    to_merge = [g for g in groups if g.group_id in group_ids]
    remaining = [g for g in groups if g.group_id not in group_ids]

    all_indices: list[int] = []
    for g in to_merge:
        all_indices.extend(g.voice_indices)

    merged_voices = [v for v in voices if v.index in all_indices]
    merged_voices.sort(key=lambda v: v.frame)

    merged = DialogueGroup(
        group_id=0,
        voice_indices=[v.index for v in merged_voices],
        start_frame=merged_voices[0].frame,
        end_frame=max(v.frame + v.length for v in merged_voices),
        context_text=" ".join(v.serif for v in merged_voices),
        auto_detected=False,
    )

    result = remaining + [merged]
    result.sort(key=lambda g: g.start_frame)
    for i, g in enumerate(result):
        g.group_id = i
    return result


def split_group(
    groups: list[DialogueGroup],
    group_id: int,
    split_at_voice_index: int,
    voices: list[VoiceItem],
) -> list[DialogueGroup]:
    target = next((g for g in groups if g.group_id == group_id), None)
    if target is None:
        return groups

    if split_at_voice_index not in target.voice_indices:
        return groups

    idx = target.voice_indices.index(split_at_voice_index)
    if idx == 0:
        return groups

    indices_a = target.voice_indices[:idx]
    indices_b = target.voice_indices[idx:]

    voices_a = sorted([v for v in voices if v.index in indices_a], key=lambda v: v.frame)
    voices_b = sorted([v for v in voices if v.index in indices_b], key=lambda v: v.frame)

    group_a = DialogueGroup(
        group_id=0,
        voice_indices=indices_a,
        start_frame=voices_a[0].frame,
        end_frame=max(v.frame + v.length for v in voices_a),
        context_text=" ".join(v.serif for v in voices_a),
        auto_detected=False,
    )
    group_b = DialogueGroup(
        group_id=0,
        voice_indices=indices_b,
        start_frame=voices_b[0].frame,
        end_frame=max(v.frame + v.length for v in voices_b),
        context_text=" ".join(v.serif for v in voices_b),
        auto_detected=False,
    )

    remaining = [g for g in groups if g.group_id != group_id]
    result = remaining + [group_a, group_b]
    result.sort(key=lambda g: g.start_frame)
    for i, g in enumerate(result):
        g.group_id = i
    return result


def build_group_contexts(
    groups: list[DialogueGroup],
) -> dict[int, str]:
    """voice_index -> group context text"""
    contexts: dict[int, str] = {}
    for g in groups:
        for vi in g.voice_indices:
            contexts[vi] = g.context_text
    return contexts
