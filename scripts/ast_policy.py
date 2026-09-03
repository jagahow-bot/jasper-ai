"""AST allowlist checker for stage contrib packages (design §4.2 / G1).

Walks Python files under ``apps/api/app/engine/stages/contrib/**`` and rejects
disallowed imports / calls. Exit 0 when clean; exit 1 on violations.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRIB_ROOT = ROOT / "apps" / "api" / "app" / "engine" / "stages" / "contrib"

ALLOWED_IMPORT_ROOTS = {
    "numpy",
    "np",
    "pandas",
    "pd",
    "math",
    "dataclasses",
    "typing",
    "collections",
    "functools",
    "itertools",
    "numbers",
    "decimal",
    "app.engine.weights",
    "app.engine.stages",
    "app.engine.stages.base",
    "app.engine.customization",
    "app.engine.allocator",
    "app.engine.objectives",
    "app.engine.factors",
    "app.engine.spec",
    "app.models",
}

# Top-level modules that are always forbidden in contrib.
FORBIDDEN_MODULES = {
    "os",
    "sys",
    "subprocess",
    "socket",
    "requests",
    "httpx",
    "urllib",
    "pathlib",
    "shutil",
    "pickle",
    "ctypes",
    "multiprocessing",
    "threading",
    "asyncio",
    "random",  # randomness must come from StageContext.seed
}

FORBIDDEN_BUILTINS = {"eval", "exec", "compile", "__import__", "open", "input"}


class PolicyVisitor(ast.NodeVisitor):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.violations: list[str] = []

    def _fail(self, node: ast.AST, msg: str) -> None:
        line = getattr(node, "lineno", 0)
        self.violations.append(f"{self.path}:{line}: {msg}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root in FORBIDDEN_MODULES:
                self._fail(node, f"forbidden import {alias.name}")
            elif alias.name not in ALLOWED_IMPORT_ROOTS and root not in (
                "numpy",
                "pandas",
                "math",
                "dataclasses",
                "typing",
                "collections",
                "functools",
                "itertools",
                "numbers",
                "decimal",
                "app",
            ):
                # Allow scipy only if already a project dep — still flag new third parties.
                if root not in {"scipy", "sklearn"}:
                    self._fail(node, f"import not on allowlist: {alias.name}")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        mod = node.module or ""
        root = mod.split(".")[0] if mod else ""
        if root in FORBIDDEN_MODULES:
            self._fail(node, f"forbidden from-import {mod}")
        elif mod.startswith("app.") and not any(
            mod == a or mod.startswith(a + ".") for a in ALLOWED_IMPORT_ROOTS if a.startswith("app.")
        ):
            # Narrow app.* to engine public surfaces.
            if not mod.startswith("app.engine") and mod != "app.models":
                self._fail(node, f"from-import not on allowlist: {mod}")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        name = None
        if isinstance(node.func, ast.Name):
            name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            name = node.func.attr
        if name in FORBIDDEN_BUILTINS:
            self._fail(node, f"forbidden call {name}()")
        # getattr/setattr on dunder
        if name in {"getattr", "setattr"} and node.args:
            arg0 = node.args[0] if len(node.args) > 1 else None
            arg1 = node.args[1] if len(node.args) > 1 else None
            if isinstance(arg1, ast.Constant) and isinstance(arg1.value, str):
                if arg1.value.startswith("__") and arg1.value.endswith("__"):
                    self._fail(node, f"forbidden dunder {name} on {arg1.value}")
            del arg0
        self.generic_visit(node)

    def visit_While(self, node: ast.While) -> None:
        # Flag while True without an obvious break upper bound — soft warning as error.
        if isinstance(node.test, ast.Constant) and node.test.value is True:
            has_break = any(isinstance(n, ast.Break) for n in ast.walk(node))
            if not has_break:
                self._fail(node, "while True without break is forbidden")
        self.generic_visit(node)


def check_file(path: Path) -> list[str]:
    try:
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src, filename=str(path))
    except SyntaxError as exc:
        return [f"{path}: syntax error: {exc}"]
    visitor = PolicyVisitor(path)
    visitor.visit(tree)
    return visitor.violations


def check_tree(root: Path | None = None) -> list[str]:
    base = root or CONTRIB_ROOT
    if not base.exists():
        return []
    violations: list[str] = []
    for path in sorted(base.rglob("*.py")):
        if path.name == "__init__.py" and path.parent == base:
            continue
        violations.extend(check_file(path))
    return violations


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    root = Path(args[0]) if args else CONTRIB_ROOT
    violations = check_tree(root)
    if violations:
        print(f"AST policy FAILED ({len(violations)} violation(s)):")
        for v in violations:
            print(f"  {v}")
        return 1
    print(f"AST policy OK ({root})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
