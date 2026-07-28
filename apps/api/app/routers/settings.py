"""Backend validation and audit persistence for workspace settings CSV imports."""

import csv
import io
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.config import ROOT

router = APIRouter(prefix="/settings", tags=["settings"])


def _settings_dir() -> Path:
    path = ROOT / "apps" / "api" / ".cache" / "settings"
    path.mkdir(parents=True, exist_ok=True)
    return path


class PoolItem(BaseModel):
    ticker: str = Field(min_length=1)
    name: str = Field(min_length=1)
    asset_class: str = "equity"
    region: str = "us"
    product_type: str = "etf"
    enabled: bool = True


class ModelHolding(BaseModel):
    ticker: str = Field(min_length=1)
    weight: float = Field(ge=0.0, le=1.0)


class ManagedModelPortfolio(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    benchmark: str = "SPY"
    holdings: list[ModelHolding] = Field(default_factory=list)

    @field_validator("holdings", mode="after")
    @classmethod
    def _holdings_sum(cls, v: list[ModelHolding]) -> list[ModelHolding]:
        total = sum(h.weight for h in v)
        if v and (total < 0.99 or total > 1.01):
            raise ValueError(f"Holdings must sum to ~100%, got {total:.2%}")
        return v


class PoolImportReport(BaseModel):
    upserted: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)
    items: list[PoolItem] = Field(default_factory=list)
    valid: bool = False


class ModelsImportReport(BaseModel):
    imported: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)
    portfolios: list[ManagedModelPortfolio] = Field(default_factory=list)
    valid: bool = False


class CsvPayload(BaseModel):
    csv_text: str


def _split_csv_line(line: str) -> list[str]:
    out: list[str] = []
    cur = ""
    in_quotes = False
    for i, ch in enumerate(line):
        if in_quotes:
            if ch == '"' and i + 1 < len(line) and line[i + 1] == '"':
                cur += '"'
            elif ch == '"':
                in_quotes = False
            else:
                cur += ch
        elif ch == '"':
            in_quotes = True
        elif ch == ",":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def _parse_csv_rows(csv_text: str) -> tuple[list[str], list[list[str]]]:
    text = csv_text.lstrip("\ufeff")
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return [], []
    header = [h.strip().lower() for h in _split_csv_line(lines[0])]
    rows = [_split_csv_line(l) for l in lines[1:]]
    return header, rows


def _save_audit(name: str, csv_text: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = _settings_dir() / f"{name}_{ts}.csv"
    path.write_text(csv_text, encoding="utf-8")


@router.post("/validate-pool", response_model=PoolImportReport)
def validate_pool_csv(payload: CsvPayload) -> PoolImportReport:
    header, rows = _parse_csv_rows(payload.csv_text)
    report = PoolImportReport()

    if not header:
        report.errors.append("CSV is empty")
        return report
    if "ticker" not in header or "name" not in header:
        report.errors.append("Missing required columns: ticker, name")
        return report

    ticker_idx = header.index("ticker")
    name_idx = header.index("name")
    asset_idx = header.index("asset_class") if "asset_class" in header else -1
    region_idx = header.index("region") if "region" in header else -1
    product_idx = header.index("product_type") if "product_type" in header else -1
    enabled_idx = header.index("enabled") if "enabled" in header else -1

    by_ticker: dict[str, PoolItem] = {}
    for i, cols in enumerate(rows, start=2):
        ticker = (cols[ticker_idx] if ticker_idx < len(cols) else "").strip().upper()
        if not ticker:
            report.skipped += 1
            report.errors.append(f"Row {i}: empty ticker")
            continue
        name = (cols[name_idx] if name_idx < len(cols) else "").strip() or ticker
        asset_class = (
            (cols[asset_idx] if asset_idx < len(cols) else "").strip() or "equity"
            if asset_idx >= 0
            else "equity"
        )
        region = (
            (cols[region_idx] if region_idx < len(cols) else "").strip() or "us"
            if region_idx >= 0
            else "us"
        )
        product_type = (
            (cols[product_idx] if product_idx < len(cols) else "").strip() or "etf"
            if product_idx >= 0
            else "etf"
        )
        enabled_raw = (
            (cols[enabled_idx] if enabled_idx < len(cols) else "true").strip().lower()
            if enabled_idx >= 0
            else "true"
        )
        enabled = enabled_raw not in {"false", "0", "no"}

        try:
            item = PoolItem(
                ticker=ticker,
                name=name,
                asset_class=asset_class,
                region=region,
                product_type=product_type,
                enabled=enabled,
            )
        except Exception as exc:  # noqa: BLE001
            report.skipped += 1
            report.errors.append(f"Row {i} ({ticker}): {exc}")
            continue

        by_ticker[ticker] = item
        report.upserted += 1

    report.items = sorted(by_ticker.values(), key=lambda x: x.ticker)
    report.valid = report.errors == [] and report.items != []
    _save_audit("pool", payload.csv_text)
    return report


@router.post("/validate-models", response_model=ModelsImportReport)
def validate_models_csv(payload: CsvPayload) -> ModelsImportReport:
    header, rows = _parse_csv_rows(payload.csv_text)
    report = ModelsImportReport()

    if not header:
        report.errors.append("CSV is empty")
        return report
    required = {"id", "name", "ticker", "weight"}
    missing = required - set(header)
    if missing:
        report.errors.append(f"Missing required columns: {', '.join(sorted(missing))}")
        return report

    id_idx = header.index("id")
    name_idx = header.index("name")
    benchmark_idx = header.index("benchmark") if "benchmark" in header else -1
    ticker_idx = header.index("ticker")
    weight_idx = header.index("weight")

    portfolios: dict[str, dict[str, Any]] = {}
    for i, cols in enumerate(rows, start=2):
        pid = (cols[id_idx] if id_idx < len(cols) else "").strip()
        name = (cols[name_idx] if name_idx < len(cols) else "").strip()
        ticker = (cols[ticker_idx] if ticker_idx < len(cols) else "").strip().upper()
        weight_raw = (cols[weight_idx] if weight_idx < len(cols) else "").strip()
        benchmark = (
            (cols[benchmark_idx] if benchmark_idx < len(cols) else "").strip().upper()
            or "SPY"
            if benchmark_idx >= 0
            else "SPY"
        )

        if not pid or not name or not ticker or not weight_raw:
            report.skipped += 1
            report.errors.append(f"Row {i}: missing id, name, ticker or weight")
            continue

        try:
            weight = float(weight_raw)
        except ValueError:
            report.skipped += 1
            report.errors.append(f"Row {i} ({pid}): invalid weight '{weight_raw}'")
            continue

        if pid not in portfolios:
            portfolios[pid] = {"name": name, "benchmark": benchmark, "holdings": []}
        portfolios[pid]["holdings"].append({"ticker": ticker, "weight": weight})

    for pid, data in portfolios.items():
        try:
            portfolio = ManagedModelPortfolio(
                id=pid,
                name=data["name"],
                benchmark=data["benchmark"],
                holdings=data["holdings"],
            )
        except Exception as exc:  # noqa: BLE001
            report.errors.append(f"Portfolio {pid}: {exc}")
            continue
        report.portfolios.append(portfolio)
        report.imported += 1

    report.valid = report.errors == [] and report.portfolios != []
    _save_audit("models", payload.csv_text)
    return report


@router.get("/pool", response_model=list[PoolItem])
def get_pool() -> list[PoolItem]:
    """Return the most recently validated pool audit, or empty if none."""
    d = _settings_dir()
    files = sorted(d.glob("pool_*.csv"), reverse=True)
    if not files:
        return []
    payload = CsvPayload(csv_text=files[0].read_text(encoding="utf-8"))
    return validate_pool_csv(payload).items


@router.get("/models", response_model=list[ManagedModelPortfolio])
def get_models() -> list[ManagedModelPortfolio]:
    """Return the most recently validated models audit, or empty if none."""
    d = _settings_dir()
    files = sorted(d.glob("models_*.csv"), reverse=True)
    if not files:
        return []
    payload = CsvPayload(csv_text=files[0].read_text(encoding="utf-8"))
    return validate_models_csv(payload).portfolios
