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


def _covering_end(frame: int, intervals: list[tuple[int, int]] | None) -> int | None:
    """frame を含む立ち絵区間 [start, end) の end を返す。含む区間が無ければ None。"""
    if not intervals:
        return None
    for start, end in intervals:
        if start <= frame < end:
            return end
    return None


def compute_face_placements(
    voice_items: list[VoiceItem],
    emotion_results: dict[int, tuple[str, dict[str, str | None]]],
    layer_offset: int = 1,
    extend_expression: bool = True,
    max_gap_extend: int = 300,
    hold_indices: set[int] | None = None,
    valid_intervals: list[tuple[int, int]] | None = None,
    hold_end_frames: dict[int, int] | None = None,
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
        hold_end_frames: Optional map voice_index -> absolute end frame for a held
            voice whose "持続ターン数" expired. When present for a held voice, the
            previous (pending) item is finalized exactly at that frame and flushed,
            so the held expression ends there instead of extending to the
            character's own next line. Computed globally by the caller (it needs the
            cross-character timeline order, which this per-character pass lacks).

    Returns:
        List of FacePlacement objects.
    """
    if not voice_items:
        return []

    hold_indices = hold_indices or set()
    hold_end_frames = hold_end_frames or {}
    sorted_voices = sorted(voice_items, key=lambda v: v.frame)
    placements: list[FacePlacement] = []
    pending: FacePlacement | None = None

    def clamped_len(start: int, proposed_end: int) -> int:
        """延長後の終端を立ち絵区間にクリップした length を返す（立ち絵不在なら延長のみ抑制せず素通し）。"""
        cov_end = _covering_end(start, valid_intervals)
        if cov_end is not None:
            proposed_end = min(proposed_end, cov_end)
        return max(1, proposed_end - start)

    def same_interval(frame_a: int, frame_b: int) -> bool:
        """両フレームが同一の立ち絵区間内か（区間情報が無ければ常に True）。"""
        if not valid_intervals:
            return True
        ea = _covering_end(frame_a, valid_intervals)
        return ea is not None and ea == _covering_end(frame_b, valid_intervals)

    def extend_end(p: "FacePlacement", next_frame: int | None) -> int:
        """フラッシュ時の延長後終端を決める。

        立ち絵区間が分かる場合は「立ち絵が表示されている間は表情を維持する」ため
        区間終端まで延長する（同区間に次アイテムがあればその開始で止める）。これにより
        max_gap_extend より長い無音でも立ち絵が続く限り表情が途切れない。
        区間情報が無い場合は従来どおり max_gap_extend を上限に次アイテムまで延長する。
        """
        own_end = p.frame + p.length
        if not extend_expression:
            return own_end
        cov_end = _covering_end(p.frame, valid_intervals)
        if valid_intervals and cov_end is not None:
            target = cov_end
            if next_frame is not None and same_interval(p.frame, next_frame):
                target = min(cov_end, next_frame)
            return max(own_end, target)  # 立ち絵を超える台詞長は配置を残す（延長のみ抑制）
        # 立ち絵情報なし: 従来のヒューリスティック上限。
        if next_frame is not None:
            gap = next_frame - own_end
            if 0 < gap <= max_gap_extend:
                return next_frame
        return own_end

    for voice in sorted_voices:
        # "前回の表情を保つ": extend the previous item over this voice and skip
        # placing a new one. With no previous item, fall through to normal handling.
        if voice.index in hold_indices and pending is not None:
            cap = hold_end_frames.get(voice.index)
            if cap is not None:
                # 持続ターン数で打ち切り: 保持表情をここ（別キャラ N 本目の終端）で確定
                # 終了し、以降は別アイテム扱い（cap〜次の自キャラ台詞は表情アイテムなし）。
                pending.length = clamped_len(pending.frame, cap)
                pending.source_serifs.append(voice.serif)
                placements.append(pending)
                pending = None
            else:
                pending.length = clamped_len(pending.frame, voice.frame + voice.length)
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
        # 場面（立ち絵区間）をまたぐ場合は結合せず、別アイテムとして配置する。
        if (
            pending is not None
            and pending.preset_name == preset_name
            and pending.parts == parts
            and same_interval(pending.frame, voice.frame)
        ):
            # Same expression: extend pending to cover this voice item
            pending.length = clamped_len(pending.frame, voice.frame + voice.length)
            pending.source_serifs.append(voice.serif)
        else:
            if pending is not None:
                pending.length = extend_end(pending, voice.frame) - pending.frame
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
        pending.length = extend_end(pending, None) - pending.frame
        placements.append(pending)

    return placements
