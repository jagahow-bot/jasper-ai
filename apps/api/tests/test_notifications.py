"""Tests for optional email notifications on terminal job states."""

from __future__ import annotations

import pytest

from app import notifications
from app.config import settings
from app.models import BacktestRequest, BacktestResult, Objective, PortfolioCandidate


def _request(notify_email: str | None) -> BacktestRequest:
    return BacktestRequest(
        scenario_id="custom",
        start_date="2018-01-01",
        end_date="2024-12-31",
        asset_classes=["equity"],
        objective=Objective.max_sharpe,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=1,
        notify_email=notify_email,
    )


def _result(job_id: str) -> BacktestResult:
    return BacktestResult(
        job_id=job_id,
        scenario_id="custom",
        benchmark="SPY",
        period={"start": "2018-01-01", "end": "2024-12-31"},
        candidates=[
            PortfolioCandidate(
                rank=1,
                model_code="M0001",
                is_champion=True,
                weights={"SPY": 1.0},
                sharpe=1.25,
                max_drawdown=-0.12,
                cagr=0.11,
                volatility=0.15,
            )
        ],
        equity_curve=[],
        efficient_frontier=[],
        narrative_facts={"champion_model_code": "M0001", "trials_completed": 5},
    )


class _FakeSMTP:
    """Records the last message sent; mimics smtplib.SMTP context manager."""

    last_message = None
    started_tls = False
    logged_in = False

    def __init__(self, host, port, timeout=None):
        self.host = host
        self.port = port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        type(self).started_tls = True

    def login(self, user, password):
        type(self).logged_in = True

    def send_message(self, msg):
        type(self).last_message = msg


@pytest.fixture
def reset_smtp(monkeypatch: pytest.MonkeyPatch):
    """Snapshot/restore the mutable settings singleton around each test."""
    keys = ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_from",
            "smtp_starttls", "smtp_ssl", "public_web_url"]
    saved = {k: getattr(settings, k) for k in keys}
    _FakeSMTP.last_message = None
    _FakeSMTP.started_tls = False
    _FakeSMTP.logged_in = False
    yield
    for k, v in saved.items():
        setattr(settings, k, v)


def test_notify_email_normalizes_blank_to_none() -> None:
    assert _request("  ").notify_email is None
    assert _request(None).notify_email is None
    assert _request("  a@b.com ").notify_email == "a@b.com"


@pytest.mark.parametrize(
    "email,valid",
    [
        ("user@example.com", True),
        ("a.b+c@sub.domain.io", True),
        ("bad", False),
        ("no-at-sign.com", False),
        ("nodot@localhost", False),
        ("", False),
        (None, False),
    ],
)
def test_is_valid_email(email, valid) -> None:
    assert notifications.is_valid_email(email) is valid


def test_notifications_configured_reflects_host(reset_smtp) -> None:
    settings.smtp_host = None
    assert notifications.notifications_configured() is False
    settings.smtp_host = "smtp.example.com"
    assert notifications.notifications_configured() is True


def test_send_skips_when_not_configured(reset_smtp, monkeypatch) -> None:
    settings.smtp_host = None
    monkeypatch.setattr(notifications.smtplib, "SMTP", _FakeSMTP)
    sent = notifications.send_job_notification(
        "job-1", _request("user@example.com"), status="completed", result=_result("job-1")
    )
    assert sent is False
    assert _FakeSMTP.last_message is None


def test_send_skips_when_no_or_invalid_email(reset_smtp, monkeypatch) -> None:
    settings.smtp_host = "smtp.example.com"
    monkeypatch.setattr(notifications.smtplib, "SMTP", _FakeSMTP)
    assert notifications.send_job_notification(
        "job-1", _request(None), status="completed", result=_result("job-1")
    ) is False
    assert _FakeSMTP.last_message is None


def test_send_completed_email_uses_full_sample_metrics(reset_smtp, monkeypatch) -> None:
    settings.smtp_host = "smtp.example.com"
    settings.smtp_port = 587
    settings.smtp_ssl = False
    settings.smtp_starttls = True
    settings.public_web_url = None
    monkeypatch.setattr(notifications.smtplib, "SMTP", _FakeSMTP)

    result = BacktestResult(
        job_id="job-full",
        scenario_id="custom",
        benchmark="SPY",
        period={"start": "2018-01-01", "end": "2026-06-30"},
        candidates=[
            PortfolioCandidate(
                rank=1,
                model_code="M0035",
                is_champion=True,
                weights={"SPY": 1.0},
                sharpe=0.63,
                max_drawdown=-0.23,
                cagr=0.12,
                volatility=0.15,
                analytics={
                    "sample_metrics": {
                        "full_sample": {
                            "sharpe": 0.359,
                            "cagr": 0.0925,
                            "max_drawdown": -0.417,
                        },
                    },
                },
            )
        ],
        equity_curve=[],
        efficient_frontier=[],
        narrative_facts={"champion_model_code": "M0035"},
    )
    sent = notifications.send_job_notification(
        "job-full", _request("user@example.com"), status="completed", result=result
    )
    assert sent is True
    body = _FakeSMTP.last_message.get_content()
    assert "full period" in body.lower()
    assert "0.36" in body
    assert "9.25%" in body
    assert "-41.70%" in body
    assert "0.63" not in body


def test_send_completed_email(reset_smtp, monkeypatch) -> None:
    settings.smtp_host = "smtp.example.com"
    settings.smtp_port = 587
    settings.smtp_user = "apikey"
    settings.smtp_password = "secret"
    settings.smtp_from = "no-reply@jasper.ai"
    settings.smtp_ssl = False
    settings.smtp_starttls = True
    settings.public_web_url = "https://jasper-ai-web.onrender.com"
    monkeypatch.setattr(notifications.smtplib, "SMTP", _FakeSMTP)

    sent = notifications.send_job_notification(
        "job-abc12345", _request("user@example.com"),
        status="completed", result=_result("job-abc12345"),
    )
    assert sent is True
    msg = _FakeSMTP.last_message
    assert msg is not None
    assert msg["To"] == "user@example.com"
    assert msg["From"] == "no-reply@jasper.ai"
    assert "complete" in msg["Subject"].lower()
    body = msg.get_content()
    assert "M0001" in body
    assert "https://jasper-ai-web.onrender.com/?job=job-abc12345" in body
    assert _FakeSMTP.started_tls is True
    assert _FakeSMTP.logged_in is True


def test_completed_email_includes_client_deep_link(reset_smtp, monkeypatch) -> None:
    settings.smtp_host = "smtp.example.com"
    settings.smtp_ssl = False
    settings.smtp_starttls = True
    settings.public_web_url = "https://jasper-ai-web.onrender.com"
    monkeypatch.setattr(notifications.smtplib, "SMTP", _FakeSMTP)

    req = _request("user@example.com")
    req = req.model_copy(update={"client_ref": "demo-chen"})
    sent = notifications.send_job_notification(
        "job-abc12345",
        req,
        status="completed",
        result=_result("job-abc12345"),
    )
    assert sent is True
    body = _FakeSMTP.last_message.get_content()
    assert (
        "https://jasper-ai-web.onrender.com/?job=job-abc12345&client=demo-chen"
        in body
    )


def test_send_failed_email(reset_smtp, monkeypatch) -> None:
    settings.smtp_host = "smtp.example.com"
    settings.smtp_ssl = False
    settings.smtp_starttls = True
    settings.public_web_url = None
    monkeypatch.setattr(notifications.smtplib, "SMTP", _FakeSMTP)

    sent = notifications.send_job_notification(
        "job-9", _request("user@example.com"), status="failed", error="boom"
    )
    assert sent is True
    msg = _FakeSMTP.last_message
    assert "failed" in msg["Subject"].lower()
    assert "boom" in msg.get_content()


def test_send_never_raises_on_smtp_error(reset_smtp, monkeypatch) -> None:
    settings.smtp_host = "smtp.example.com"

    def _boom(*a, **k):
        raise OSError("connection refused")

    monkeypatch.setattr(notifications.smtplib, "SMTP", _boom)
    sent = notifications.send_job_notification(
        "job-1", _request("user@example.com"), status="completed", result=_result("job-1")
    )
    assert sent is False
