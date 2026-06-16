# SPDX-License-Identifier: AGPL-3.0-or-later
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


def segment_by_gap(
    voices: list[VoiceItem],
    gap_frames: int = 1,
) -> dict[int, int]:
    """フレームギャップで「場面/文脈セグメント」に分割し voice_index -> segment_id を返す。

    `detect_groups` と同じギャップ判定だが、編集用グループ（merge/split）とは独立に
    解析のたびに算出する。直前台詞の終端から `gap_frames` 以上空いた箇所を境界とする。
    `gap_frames` は最小 1（=1フレーム以上の隙間で区切る）に丸める。
    """
    gap_frames = max(1, int(gap_frames))
    result: dict[int, int] = {}
    if not voices:
        return result

    sorted_voices = sorted(voices, key=lambda v: v.frame)
    seg = 0
    result[sorted_voices[0].index] = seg
    for i in range(1, len(sorted_voices)):
        prev = sorted_voices[i - 1]
        curr = sorted_voices[i]
        gap = curr.frame - (prev.frame + prev.length)
        if gap >= gap_frames:
            seg += 1
        result[curr.index] = seg
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


def build_preceding_contexts(
    voices: list[VoiceItem],
    turns: int = 2,
    speaker_labels: bool = True,
    segment_of: dict[int, int] | None = None,
) -> dict[int, list[str]]:
    """各 voice_index に対し、その台詞の直前 `turns` 件の発話を文脈として返す。

    対象台詞自身や後続は含めない（リアクションとしての感情を捉えるため、直前の
    会話の流れだけを与える）。`speaker_labels` が真なら `話者名: 台詞` 形式にして
    掛け合いの話者を区別する。返り値は voice_index -> 文脈行リスト（古い順）。

    `segment_of`（voice_index -> segment_id）が与えられた場合、対象台詞と異なる
    セグメント（=場面の切れ目より前）の発話は文脈に含めない。場面跨ぎの台詞混入を
    防ぎ、リアクション感情の誤検出を抑える。
    """
    if turns <= 0:
        return {v.index: [] for v in voices}

    ordered = sorted(voices, key=lambda v: v.frame)

    def fmt(v: VoiceItem) -> str:
        if speaker_labels and v.character_name:
            return f"{v.character_name}: {v.serif}"
        return v.serif

    contexts: dict[int, list[str]] = {}
    for i, v in enumerate(ordered):
        start = max(0, i - turns)
        prev = [ordered[j] for j in range(start, i)]
        if segment_of is not None:
            cur_seg = segment_of.get(v.index)
            prev = [p for p in prev if segment_of.get(p.index) == cur_seg]
        contexts[v.index] = [fmt(p) for p in prev]
    return contexts
