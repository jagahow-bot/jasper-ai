"""AST allowlist checker for stage contrib packages."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))

from ast_policy import check_file, check_tree, main  # noqa: E402


def test_clean_contrib_passes(tmp_path: Path) -> None:
    f = tmp_path / "ok.py"
    f.write_text(
        "from __future__ import annotations\n"
        "import numpy as np\n"
        "from app.engine.stages.base import StageIssue\n"
        "def f(x):\n"
        "    return np.asarray(x)\n",
        encoding="utf-8",
    )
    assert check_file(f) == []


def test_forbidden_import_fails(tmp_path: Path) -> None:
    f = tmp_path / "bad.py"
    f.write_text("import os\nprint(os.getcwd())\n", encoding="utf-8")
    viol = check_file(f)
    assert any("forbidden import os" in v for v in viol)


def test_eval_forbidden(tmp_path: Path) -> None:
    f = tmp_path / "eval.py"
    f.write_text("eval('1+1')\n", encoding="utf-8")
    viol = check_file(f)
    assert any("eval" in v for v in viol)


def test_empty_contrib_tree_ok() -> None:
    assert check_tree(Path("/nonexistent/contrib/path")) == []
    assert main([]) == 0


def test_main_rejects_bad_tree(tmp_path: Path) -> None:
    bad = tmp_path / "bad.py"
    bad.write_text("import subprocess\n", encoding="utf-8")
    assert main([str(tmp_path)]) == 1
