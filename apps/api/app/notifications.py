"""Best-effort email notifications for terminal backtest job states.

The whole feature is opt-in and fail-soft:

* It stays disabled until an operator sets ``SMTP_HOST`` (see ``config.py``).
* A job only triggers an email when the request carried a ``notify_email``.
* Sending never raises into the job thread — failures are swallowed and logged
  so a flaky mail server can never fail or block a completed backtest.
"""

from __future__ import annotations

import logging
import re
import smtplib
import ssl
from email.message import EmailMessage

from app.champion_metrics import champion_display_metrics
from app.config import settings
from app.models import BacktestRequest, BacktestResult

logger = logging.getLogger(__name__)

# Deliberately permissive: we only want to skip obvious garbage, not police
# every RFC 5322 edge case (that would risk dropping deliverable addresses).
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def notifications_configured() -> bool:
    """True when an SMTP host is configured (feature is enabled)."""
    return bool(settings.smtp_host)


def is_valid_email(email: str | None) -> bool:
    return bool(email) and bool(_EMAIL_RE.match(email.strip()))


def _results_link(job_id: str) -> str | None:
    base = (settings.public_web_url or "").strip().rstrip("/")
    if not base:
        return None
    return f"{base}/?job={job_id}"


def _champion(result: BacktestResult):
    for cand in result.candidates:
        if getattr(cand, "is_champion", False):
            return cand
    return result.candidates[0] if result.candidates else None


def _completed_body(job_id: str, req: BacktestRequest, result: BacktestResult) -> str:
    champ = _champion(result)
    lines = [
        "Your JASPER.AI backtest finished successfully.",
        "",
        f"Job ID: {job_id}",
        f"Objective: {req.objective.value if hasattr(req.objective, 'value') else req.objective}",
        f"Period: {req.start_date} → {req.end_date}",
    ]
    if champ is not None:
        metrics = champion_display_metrics(champ)
        lines += [
            "",
            "Champion model (full period):",
            f"  Code:    {champ.model_code or 'M?'}",
            f"  Sharpe:  {metrics.sharpe:.2f}",
            f"  CAGR:    {metrics.cagr * 100:.2f}%",
            f"  Max DD:  {metrics.max_drawdown * 100:.2f}%",
        ]
    link = _results_link(job_id)
    if link:
        lines += ["", f"View the full report: {link}"]
    else:
        lines += ["", "Open the app and load this job from the history panel to view results."]
    lines += ["", "— JASPER.AI"]
    return "\n".join(lines)


def _failed_body(job_id: str, req: BacktestRequest, error: str | None) -> str:
    lines = [
        "Your JASPER.AI backtest did not complete.",
        "",
        f"Job ID: {job_id}",
        f"Objective: {req.objective.value if hasattr(req.objective, 'value') else req.objective}",
        f"Period: {req.start_date} → {req.end_date}",
        "",
        f"Reason: {error or 'Unknown error'}",
        "",
        "You can adjust the configuration and try again.",
        "",
        "— JASPER.AI",
    ]
    return "\n".join(lines)


def _send(to_email: str, subject: str, body: str) -> bool:
    host = settings.smtp_host
    if not host:
        return False

    from_addr = settings.smtp_from or settings.smtp_user or "no-reply@jasper.ai"
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    port = int(settings.smtp_port)
    try:
        if settings.smtp_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as server:
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password or "")
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as server:
                if settings.smtp_starttls:
                    server.starttls(context=ssl.create_default_context())
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password or "")
                server.send_message(msg)
        return True
    except Exception:  # noqa: BLE001 — never propagate into the job thread
        logger.exception("Failed to send job notification email to %s", to_email)
        return False


def send_job_notification(
    job_id: str,
    req: BacktestRequest,
    *,
    status: str,
    result: BacktestResult | None = None,
    error: str | None = None,
) -> bool:
    """Send a terminal-state email if configured and requested.

    Returns True only when an email was actually sent. All other cases
    (feature disabled, no/invalid recipient, send failure) return False and
    never raise.
    """
    to_email = (req.notify_email or "").strip()
    if not notifications_configured():
        logger.warning(
            "email notification skipped: SMTP not set (job %s, recipient %s)",
            job_id,
            to_email,
        )
        return False
    if not is_valid_email(to_email):
        logger.warning(
            "email notification skipped: invalid recipient %r (job %s)",
            to_email,
            job_id,
        )
        return False

    if status == "completed" and result is not None:
        subject = f"JASPER.AI backtest complete — {job_id[:8]}"
        body = _completed_body(job_id, req, result)
    elif status == "failed":
        subject = f"JASPER.AI backtest failed — {job_id[:8]}"
        body = _failed_body(job_id, req, error)
    else:
        return False

    return _send(to_email, subject, body)
