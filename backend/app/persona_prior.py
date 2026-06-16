# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

"""キャラ性格マップ(#4) — 感情価×覚醒度の事前分布。

キャラを2軸（valence: ネガ⇔ポジ / arousal: 落ち着き⇔ハイテンション）に配置し、
各感情の固定座標との親和度から「中心0・strengthでスケール」した加算バイアスを作る。
キャラ位置に近い感情を加点・遠い感情を減点する弱い prior（本文を無視しない程度）。
"""

import math

from .emotion.base import EMOTION_LABELS

# 各感情の (valence, arousal) 座標（-1..1）。Russell の感情円環に概ね沿う。
EMOTION_COORDS: dict[str, tuple[float, float]] = {
    "joy": (0.8, 0.5),
    "happiness": (0.6, 0.1),
    "anger": (-0.7, 0.8),
    "sadness": (-0.7, -0.5),
    "fear": (-0.6, 0.7),
    "disgust": (-0.6, 0.1),
    "surprise": (0.0, 0.9),
    "embarrassment": (0.3, 0.2),
    "exasperation": (-0.4, -0.2),
}

# バイアスの最大スケール（strength=1 のときの最大加点幅の目安）。
PRIOR_MAX = 0.25


def emotion_bias(valence: float, arousal: float, strength: float) -> dict[str, float]:
    """キャラ位置 (valence, arousal) と strength から、感情別の中心0バイアスを返す。

    strength<=0 なら全0（無効）。近い感情ほど正、遠い感情ほど負で、平均0に正規化。
    """
    if strength <= 0:
        return {e: 0.0 for e in EMOTION_LABELS}

    v = max(-1.0, min(1.0, float(valence)))
    a = max(-1.0, min(1.0, float(arousal)))

    # 親和度 = 最大距離からの差（近いほど大）。最大距離 = 2軸 [-1,1] の対角 = 2*sqrt(2)。
    max_dist = 2.0 * math.sqrt(2.0)
    affinity: dict[str, float] = {}
    for e in EMOTION_LABELS:
        ex, ey = EMOTION_COORDS.get(e, (0.0, 0.0))
        dist = math.hypot(ex - v, ey - a)
        affinity[e] = max_dist - dist

    mean = sum(affinity.values()) / len(affinity)
    # 中心0化 → 最大絶対値で正規化 → strength*PRIOR_MAX でスケール。
    centered = {e: affinity[e] - mean for e in EMOTION_LABELS}
    peak = max((abs(x) for x in centered.values()), default=0.0) or 1.0
    scale = strength * PRIOR_MAX / peak
    return {e: centered[e] * scale for e in EMOTION_LABELS}


def apply(result, valence: float, arousal: float, strength: float):
    """EmotionResult に prior バイアスを加算（in-place）。[0,1] クランプ。"""
    bias = emotion_bias(valence, arousal, strength)
    for e in EMOTION_LABELS:
        cur = getattr(result, e)
        setattr(result, e, max(0.0, min(1.0, cur + bias[e])))
    return result
