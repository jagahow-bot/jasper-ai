"""Overlay group_weight_band enforcement for signed RM sleeve targets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from app.engine.weights import project_max_weight


@dataclass(frozen=True)
class GroupWeightBand:
    group_id: str | None
    tickers: tuple[str, ...]
    target_pct: float | None = None
    min_pct: float | None = None
    max_pct: float | None = None


def _band_target(band: GroupWeightBand) -> float | None:
    if band.target_pct is not None and float(band.target_pct) > 0:
        return float(band.target_pct)
    lo = band.min_pct
    hi = band.max_pct
    if lo is not None and hi is not None:
        return float(lo + hi) / 2.0
    if lo is not None:
        return float(lo)
    if hi is not None:
        return float(hi)
    return None


def parse_group_weight_bands(raw: Any) -> list[GroupWeightBand]:
    """Parse ClientContext.group_weight_bands into typed bands."""
    if not raw:
        return []
    items = raw if isinstance(raw, list) else []
    out: list[GroupWeightBand] = []
    for item in items:
        if isinstance(item, GroupWeightBand):
            out.append(item)
            continue
        if not isinstance(item, dict):
            continue
        tickers = item.get("tickers") or []
        if not tickers:
            continue
        out.append(
            GroupWeightBand(
                group_id=str(item.get("group_id") or "").strip() or None,
                tickers=tuple(str(t).upper() for t in tickers if str(t).strip()),
                target_pct=_maybe_float(item.get("target_pct")),
                min_pct=_maybe_float(item.get("min_pct")),
                max_pct=_maybe_float(item.get("max_pct")),
            )
        )
    return out


def _maybe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _indices(col: dict[str, int], tickers: tuple[str, ...]) -> list[int]:
    return [col[t] for t in tickers if t in col]


def _find_parent_idx(
    idx: list[int], prior_bands: list[GroupWeightBand], col: dict[str, int]
) -> list[int] | None:
    idx_set = set(idx)
    for prior in prior_bands:
        pidx = _indices(col, prior.tickers)
        if pidx and idx_set.issubset(set(pidx)) and len(idx) < len(pidx):
            return pidx
    return None


def apply_group_weight_bands(
    w: np.ndarray,
    tickers: list[str],
    bands: list[GroupWeightBand],
    *,
    max_weight: float,
) -> np.ndarray:
    """Reshape weights toward signed overlay group targets (pre-drift).

    Outer bands (more tickers) set absolute portfolio fractions. Inner bands
    whose tickers are a strict subset of a prior band interpret ``target_pct``
    as a within-group share (e.g. BIL 70% of hedge sleeve).
    """
    if not bands:
        return np.asarray(w, dtype=float)
    col = {str(t).upper(): i for i, t in enumerate(tickers)}
    out = np.maximum(np.asarray(w, dtype=float).copy(), 0.0)
    ordered = sorted(bands, key=lambda b: (-len(b.tickers), b.group_id or ""))

    touched: set[int] = set()
    for bi, band in enumerate(ordered):
        idx = _indices(col, band.tickers)
        if not idx:
            continue
        target = _band_target(band)
        if target is None or target <= 0:
            continue

        parent_idx = _find_parent_idx(idx, ordered[:bi], col)

        if parent_idx is not None and target <= 1.0 + 1e-9:
            parent_total = float(sum(out[i] for i in parent_idx))
            if parent_total <= 1e-12:
                for prior in ordered[:bi]:
                    if set(_indices(col, prior.tickers)) == set(parent_idx):
                        parent_total = float(_band_target(prior) or 0.0)
                        break
            group_mass = target * parent_total
            siblings = [i for i in parent_idx if i not in idx]
            sibling_mass = max(0.0, parent_total - group_mass)
            per = group_mass / len(idx) if idx else 0.0
            for i in idx:
                out[i] = per
            if siblings and sibling_mass > 0:
                sib_sum = float(sum(out[i] for i in siblings))
                if sib_sum > 1e-12:
                    for i in siblings:
                        out[i] = out[i] / sib_sum * sibling_mass
                else:
                    per_s = sibling_mass / len(siblings)
                    for i in siblings:
                        out[i] = per_s
        else:
            current = float(sum(out[i] for i in idx))
            if current > 1e-12:
                scale = target / current
                for i in idx:
                    out[i] *= scale
            else:
                per = target / len(idx)
                for i in idx:
                    out[i] = per
        touched.update(idx)

    band_sum = float(sum(out[i] for i in touched))
    remainder = max(0.0, 1.0 - band_sum)
    non_band = [i for i in range(len(out)) if i not in touched]
    if non_band:
        if remainder > 1e-12:
            nb_sum = float(sum(out[i] for i in non_band))
            if nb_sum > 1e-12:
                for i in non_band:
                    out[i] = out[i] / nb_sum * remainder
            else:
                per = remainder / len(non_band)
                for i in non_band:
                    out[i] = per
        else:
            # Bands consume the full budget — zero out non-band positions.
            for i in non_band:
                out[i] = 0.0

    s = float(out.sum())
    if s > 1e-12 and abs(s - 1.0) > 1e-9:
        out /= s
    if float(max_weight) < 1.0 - 1e-12:
        out = project_max_weight(out, float(max_weight))
    return out


def group_weight_bands_from_client_context(client_context: Any) -> list[GroupWeightBand]:
    """Extract signed overlay bands from BacktestRequest.client_context."""
    if client_context is None:
        return []
    raw = getattr(client_context, "group_weight_bands", None)
    if raw is None and isinstance(client_context, dict):
        raw = client_context.get("group_weight_bands")
    return parse_group_weight_bands(raw)
