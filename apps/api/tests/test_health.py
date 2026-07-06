"""Health endpoint exposes optional feature flags for the web UI."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import settings
from main import app

client = TestClient(app)


def test_health_reports_email_notifications_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "smtp_host", None)
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["email_notifications"] == "disabled"


def test_health_reports_email_notifications_configured(monkeypatch) -> None:
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["email_notifications"] == "configured"
