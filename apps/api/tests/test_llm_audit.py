"""Tests for the provider-agnostic LLM audit trail."""

from __future__ import annotations

from app.llm_audit import (
    append_llm_audit_entry,
    build_audit_entry,
    clear_llm_audit_context,
    get_llm_audit_logs,
    merge_llm_audit_logs,
    pop_llm_audit_logs,
    reset_llm_audit_logs,
    set_llm_audit_job_id,
)


def test_append_and_pop_logs() -> None:
    job_id = "audit-test-1"
    with set_llm_audit_job_id(job_id):
        append_llm_audit_entry(
            build_audit_entry(
                provider="google",
                model_id="gemini-3.6-flash",
                call_type="json",
                prompt="prompt",
                system="system",
                temperature=0.5,
                max_output_tokens=1024,
                response_mime_type="application/json",
                raw_response="{}",
                finish_reason="STOP",
                usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                duration_ms=123.4,
            )
        )

    logs = pop_llm_audit_logs(job_id)
    assert len(logs) == 1
    assert logs[0]["provider"] == "google"
    assert logs[0]["model_id"] == "gemini-3.6-flash"
    assert logs[0]["usage"]["total_tokens"] == 15


def test_get_logs_does_not_clear() -> None:
    job_id = "audit-test-2"
    with set_llm_audit_job_id(job_id):
        append_llm_audit_entry({"timestamp": "t1", "provider": "moonshot"})

    assert len(get_llm_audit_logs(job_id)) == 1
    assert len(get_llm_audit_logs(job_id)) == 1
    pop_llm_audit_logs(job_id)


def test_merge_logs() -> None:
    job_id = "audit-test-3"
    with set_llm_audit_job_id(job_id):
        append_llm_audit_entry({"timestamp": "t1", "provider": "google"})

    merge_llm_audit_logs(job_id, [{"timestamp": "t2", "provider": "moonshot"}])
    logs = pop_llm_audit_logs(job_id)
    assert len(logs) == 2
    providers = {log["provider"] for log in logs}
    assert providers == {"google", "moonshot"}


def test_reset_logs() -> None:
    job_id = "audit-test-4"
    with set_llm_audit_job_id(job_id):
        append_llm_audit_entry({"timestamp": "t1", "provider": "google"})
    reset_llm_audit_logs(job_id)
    assert pop_llm_audit_logs(job_id) == []


def test_no_job_context_drops_entry() -> None:
    clear_llm_audit_context()
    append_llm_audit_entry({"timestamp": "t1", "provider": "google"})
    # No job bound; entry is silently dropped.
    assert get_llm_audit_logs("no-job") == []
