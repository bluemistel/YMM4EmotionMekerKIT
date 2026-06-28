# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

"""個人適応学習(#1) — 凍結 BERT 埋め込み上の軽量ヘッド。

ユーザーの手ラベル（単一主感情）で小さな分類ヘッドを学習し、解析時に base の
9感情ベクトルへ「中心0・データ量と強度でスケール・[0,1]クランプ」した加算バイアスを
与える。base を置換せず弱く補正するだけなので、複合検出構造を壊さない。

ローカル BERT 専用（埋め込みが必要）。新規依存なし（torch のみ）。
"""

import random

import torch
import torch.nn as nn
import torch.nn.functional as F

from .emotion.base import EMOTION_LABELS, EmotionResult
from . import training_store

# バイアス強度の係数。alpha = ALPHA_MAX * min(1, N / N_REF)。
# データが少ないほど控えめに、貯まるほど効く（自動減衰）。
ALPHA_MAX = 0.6
N_REF = 800

# 2層MLPヘッドを使う最小サンプル数。これ未満は素の線形（過学習回避）。
MLP_MIN_SAMPLES = 120
MLP_HIDDEN = 256
MLP_DROPOUT = 0.2

# 辞書(lexicon)に登録された語を含む台詞の学習重み。辞書側で推論時に強制されるため、
# ヘッドがその語の埋め込みに過剰反応（過学習）しないよう寄与を下げる。
DICT_DOWNWEIGHT = 0.3

_NUM_CLASSES = len(EMOTION_LABELS)

# 読み込み済みヘッドのキャッシュ（mtime で無効化）。
_cache: dict = {"mtime": None, "model": None, "meta": None}


class PersonalizationHead(nn.Module):
    """埋め込み → 9感情ロジット。

    arch="linear": 素の線形（少データ向け・過学習を避ける）。
    arch="mlp":    Linear(input,hidden) → ReLU → Dropout → Linear(hidden,9)。
        凍結BERTの出力をユーザー嗜好に合わせて非線形に曲げる柔軟性を持たせる。
        十分なデータが貯まったときのみ採用する（train() 側でゲート）。
    """

    def __init__(self, input_dim: int, arch: str = "linear", hidden: int = MLP_HIDDEN, dropout: float = MLP_DROPOUT):
        super().__init__()
        self.input_dim = input_dim
        self.arch = arch
        self.hidden = hidden
        self.dropout = dropout
        if arch == "mlp":
            self.net = nn.Sequential(
                nn.Linear(input_dim, hidden),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Linear(hidden, _NUM_CLASSES),
            )
        else:
            self.net = nn.Linear(input_dim, _NUM_CLASSES)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def _l2norm(x: torch.Tensor) -> torch.Tensor:
    return x / x.norm(dim=-1, keepdim=True).clamp(min=1e-9)


def _dict_downweights(texts: list[str]) -> torch.Tensor:
    """辞書(lexicon)パターンを含む台詞のサンプル重みを下げたベクトルを返す。

    辞書が空、または読込失敗時は全て 1.0（影響なし）。char 限定エントリも語の
    過学習防止が目的なのでキャラを問わず pattern 一致で判定する。
    """
    w = torch.ones(len(texts), dtype=torch.float)
    try:
        from .emotion_lexicon import load_lexicon
        patterns = [e.pattern for e in load_lexicon() if e.pattern]
    except Exception:
        patterns = []
    if not patterns:
        return w
    for i, t in enumerate(texts):
        if t and any(p in t for p in patterns):
            w[i] = DICT_DOWNWEIGHT
    return w


def train(analyzer, epochs: int = 300, lr: float = 0.01) -> dict:
    """保存済みラベルでヘッドを学習し head.pt / head_meta.json を保存。stats を返す。"""
    records = [r for r in training_store.load_labels() if r.get("emotion") in EMOTION_LABELS]
    counts = {e: 0 for e in EMOTION_LABELS}
    for r in records:
        counts[r["emotion"]] += 1
    n = len(records)
    if n < _NUM_CLASSES * 2:
        return {"trained": False, "reason": "insufficient_data", "total": n, "counts": counts}

    texts = [r["text"] for r in records]
    y = torch.tensor([EMOTION_LABELS.index(r["emotion"]) for r in records], dtype=torch.long)
    emb = _l2norm(analyzer.embed_batch(texts))
    dim = emb.shape[1]

    # クラス重み（逆頻度）。0件クラスは重み0で寄与なし。
    freq = torch.tensor([counts[e] for e in EMOTION_LABELS], dtype=torch.float)
    weights = torch.where(freq > 0, freq.sum() / (freq * _NUM_CLASSES), torch.zeros_like(freq))

    # 辞書語ダウンウェイト: 辞書に登録された語を含む台詞は学習寄与を下げる
    # （推論時は辞書が最終段で強制するため、ヘッドが二重に過学習しないように）。
    sample_w = _dict_downweights(texts)

    # 簡易 holdout（クラスが十分あるときのみ概算精度を出す）。
    idx = list(range(n))
    random.Random(42).shuffle(idx)
    holdout = idx[: max(1, n // 5)] if n >= 30 else []
    hold_set = set(holdout)
    train_idx = [i for i in idx if i not in hold_set]

    # データが十分なら2層MLP、少なければ線形（過学習回避）。
    arch = "mlp" if n >= MLP_MIN_SAMPLES else "linear"
    model = PersonalizationHead(dim, arch=arch)
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-3)
    xt = emb[train_idx]
    yt = y[train_idx]
    wt = sample_w[train_idx]
    model.train()
    for _ in range(epochs):
        opt.zero_grad()
        # クラス重み付き CE をサンプル単位で算出し、辞書語サンプルの重みを掛けて平均。
        ce = F.cross_entropy(model(xt), yt, weight=weights, reduction="none")
        loss = (ce * wt).sum() / wt.sum().clamp(min=1e-6)
        loss.backward()
        opt.step()

    holdout_acc = None
    if holdout:
        model.eval()
        with torch.no_grad():
            pred = model(emb[holdout]).argmax(dim=1)
            holdout_acc = float((pred == y[holdout]).float().mean())

    torch.save(
        {"state_dict": model.state_dict(), "input_dim": dim, "l2norm": True,
         "arch": arch, "hidden": MLP_HIDDEN, "dropout": MLP_DROPOUT},
        training_store.head_path(),
    )
    meta = {
        "total": n,
        "counts": counts,
        "input_dim": dim,
        "arch": arch,
        "hidden": MLP_HIDDEN,
        "dropout": MLP_DROPOUT,
        "holdout_acc": holdout_acc,
        "alpha_max": ALPHA_MAX,
        "n_ref": N_REF,
        "trained_at": __import__("time").time(),
    }
    training_store.save_head_meta(meta)
    invalidate_cache()
    return {"trained": True, "total": n, "counts": counts, "holdout_acc": holdout_acc, "arch": arch}


def invalidate_cache() -> None:
    _cache["mtime"] = None
    _cache["model"] = None
    _cache["meta"] = None


def _load_head():
    """head.pt を（mtime キャッシュ付きで）読み込む。無ければ (None, None)。"""
    if not training_store.head_exists():
        return None, None
    path = training_store.head_path()
    mtime = path.stat().st_mtime
    if _cache["mtime"] == mtime and _cache["model"] is not None:
        return _cache["model"], _cache["meta"]
    try:
        blob = torch.load(path, map_location="cpu", weights_only=False)
        # 旧 head.pt は arch キーを持たない → linear として再構築（後方互換）。
        model = PersonalizationHead(
            int(blob["input_dim"]),
            arch=blob.get("arch", "linear"),
            hidden=int(blob.get("hidden", MLP_HIDDEN)),
            dropout=float(blob.get("dropout", MLP_DROPOUT)),
        )
        model.load_state_dict(blob["state_dict"])
        model.eval()
        meta = training_store.load_head_meta() or {}
        meta["_l2norm"] = bool(blob.get("l2norm", True))
        _cache.update({"mtime": mtime, "model": model, "meta": meta})
        return model, meta
    except Exception:
        return None, None


def is_available() -> bool:
    return training_store.head_exists()


def apply(base_results: list[EmotionResult], embeddings: torch.Tensor, strength: float) -> list[EmotionResult]:
    """base の9感情ベクトルへ、学習ヘッドの予測に基づく加算バイアスを適用（in-place）。

    bias_e = softmax(head(emb))_e - 1/9 （中心0）
    scaled = alpha * strength * bias  （alpha はデータ量で自動減衰）
    new = clamp(base + scaled, 0, 1)
    """
    model, meta = _load_head()
    if model is None or embeddings is None or len(base_results) == 0:
        return base_results
    if embeddings.shape[0] != len(base_results):
        return base_results

    n_total = int(meta.get("total", 0))
    alpha_max = float(meta.get("alpha_max", ALPHA_MAX))
    n_ref = float(meta.get("n_ref", N_REF))
    alpha = alpha_max * min(1.0, n_total / n_ref) if n_ref > 0 else alpha_max
    scale = alpha * max(0.0, float(strength))
    if scale <= 0:
        return base_results

    x = embeddings
    if meta.get("_l2norm", True):
        x = _l2norm(x)
    with torch.no_grad():
        probs = torch.softmax(model(x), dim=1)
    uniform = 1.0 / _NUM_CLASSES

    for row, result in enumerate(base_results):
        for i, emo in enumerate(EMOTION_LABELS):
            bias = float(probs[row, i]) - uniform
            cur = getattr(result, emo)
            setattr(result, emo, max(0.0, min(1.0, cur + scale * bias)))
    return base_results
