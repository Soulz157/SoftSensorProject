"""`kind: 'formula'` evaluator — the port `feature_service.py`'s own module
docstring named as deferred, now scoped down and closed.

The full-mathjs framing that deferral used ("a new Python math-parser
dependency and an approximation, not an exact match") does not describe what
actually reaches this module. By the time a formula gets here:

* `tokenizeColumns` (`apps/client/lib/formula.ts`) has already rewritten
  every real column name to a generated alias (`c0`, `c1`, …) — column names
  containing `-`/`.` never survive into the expression itself. The parity
  fixture (`packages/parity-fixtures/feature_formula.json`) confirms the
  shape: `expr: "c0 + c1"`, `vars: {c0: "TI-101", c1: "VI-202"}`.
* Every real preset formula inspected in this workspace's MinIO
  (`feature-presets/…/*.json`) is plain arithmetic, e.g.
  `(S001Aromatics.Lab*FI001.PV)/(FI003.PV+FI001.PV)`.

So the grammar actually needed is: numeric literals, alias identifiers,
`+ - * /`, parentheses, unary `+`/`-`. For those four binary operators IEEE
754 doubles make JavaScript and Python agree bit-for-bit — real parity, not
an approximation.

`^` is deliberately EXCLUDED, not merely unimplemented. mathjs `^` and
Python `**` genuinely diverge — `(-8) ** (1/3)` is `NaN` in JS and a complex
number in Python, and Python's arbitrary-precision integers overflow
differently from JS doubles. Implementing it would be exactly the
"approximation, not an exact match" the original deferral warned against.
Precedence parity between mathjs and Python's `ast` grammar ALSO only holds
because `^` is excluded — mathjs binds `^` tighter than `*`/`/`, Python's `^`
(BitXor) binds looser than everything arithmetic, so `2*c0^2` parses to two
different trees in the two languages. Currently unreachable since `^` is
rejected outright; if a future change ever adds `^`/`**` support, precedence
must be re-verified from scratch, not assumed from this module's other
operators.
Function calls are excluded the same way, and for a second, independent
reason: `toFeatureConfigs` (`feature-preset.ts`) — the ONLY producer of
`formula` configs in this codebase — never calls `validateFormula`, so a
preset's workbook formula reaches this module unvalidated. Anything outside
the grammar below MUST raise, never be evaluated, guessed at, or coerced.

Uses `ast`, not a hand-rolled parser, but walks the parsed tree and allows
only the node types listed in `_ALLOWED_NODES` — this is a whitelist
evaluator, not `eval()` on a trusted string. The expression is alias-only by
construction (real column names never survive tokenization), but a
whitelist is what makes that a property of THIS module, not an assumption
borrowed from the caller.
"""

from __future__ import annotations

import ast
import math
from typing import Mapping


class FormulaError(ValueError):
    """Invalid or out-of-grammar formula, safe to surface to the caller.

    Not `feature_service.FeatureError` — importing that here would make
    `feature_service` and `formula_service` import each other
    (`feature_service` needs `compile_formula`/`eval_formula_row`, this
    module would need `FeatureError`). Same `ValueError` base, so it still
    maps to a 422 through the SAME generic `except ValueError` branch every
    other feature/cleaning error uses (`routers/preprocess.py:87-88`) —
    nothing downstream distinguishes the two by exact type, only by
    `isinstance(e, ValueError)`.
    """


# Every AST node this evaluator accepts. Deliberately short — anything not
# listed here (Call, Compare, BoolOp, Attribute, Subscript, comprehensions,
# ...) raises FormulaError before it is ever walked, let alone evaluated.
_ALLOWED_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Constant,
    ast.Name,
    ast.Load,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.UAdd,
    ast.USub,
)

# mathjs/JS `^` is exponentiation, and that literal character is what a
# tokenized formula carries (`c0 ^ 2`) — but Python's own `ast` parses a
# source-level `^` as `BitXor`, NOT `Pow` (`Pow` is what Python's `**`
# produces). Checked for by name here, not merely absent from the whitelist
# above, so the rejection message is specific rather than a generic
# "unsupported syntax" — the module docstring's exclusion is a decision,
# worth surfacing as one. Both node types covered: `BitXor` is what a real
# tokenized formula would ever produce; `Pow` is guarded too in case a
# formula ever contains a literal `**` directly.
_POW_NODES = (ast.Pow, ast.BitXor)


def _validate_node(node: ast.AST, expr: str) -> None:
    if isinstance(node, _POW_NODES):
        raise FormulaError(
            f"formula {expr!r} uses '^' — not supported (JS/Python numeric "
            "divergence on non-integer exponents; see formula_service.py's "
            "module docstring). Rewrite without exponentiation."
        )
    if not isinstance(node, _ALLOWED_NODES):
        raise FormulaError(
            f"formula {expr!r} uses unsupported syntax "
            f"({type(node).__name__}) — only +, -, *, /, parentheses, and "
            "unary sign are supported."
        )
    for child in ast.iter_child_nodes(node):
        _validate_node(child, expr)


def compile_formula(expr: str) -> ast.Expression:
    """Parse and whitelist-validate one formula. Raises `FormulaError` for
    anything outside the grammar — never silently accepted, never `eval`'d
    without validation first.
    """
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise FormulaError(f"formula {expr!r} is not valid: {e}") from e
    _validate_node(tree, expr)
    return tree


def _eval_node(node: ast.AST, scope: Mapping[str, float]) -> float:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, scope)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise FormulaError(f"formula uses a non-numeric literal {node.value!r}")
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id not in scope:
            # Unreachable in practice — every Name in a formula config is one
            # of `vars`'s own keys by construction (tokenizeColumns only ever
            # emits generated aliases it also maps). Guarded anyway: silently
            # returning 0 for a stray identifier would be a wrong number, not
            # an error.
            raise FormulaError(f"formula references unknown variable {node.id!r}")
        return scope[node.id]
    if isinstance(node, ast.UnaryOp):
        v = _eval_node(node.operand, scope)
        if isinstance(node.op, ast.UAdd):
            return +v
        if isinstance(node.op, ast.USub):
            return -v
        raise FormulaError("formula uses an unsupported unary operator")
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, scope)
        right = _eval_node(node.right, scope)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        raise FormulaError("formula uses an unsupported binary operator")
    raise FormulaError(f"formula uses unsupported syntax ({type(node).__name__})")


def eval_formula_row(
    compiled: ast.Expression, scope: Mapping[str, float]
) -> float | None:
    """Evaluate one row. Mirrors `computeColumn`'s formula branch
    (`feature-engineering.ts:187-204`) — NOT the standalone `evalFormulaRow`
    in `formula.ts`, which is a different helper unused by the committed
    pipeline. `computeColumn` gates every source cell on `goodValue` (status
    === Good) exactly like every other feature kind (`_good_value` here);
    the caller is responsible for building `scope` under that same gate and
    passing `None` through as "this row is Bad" before ever calling this
    function — see `_compute_feature_column`'s `formula` branch in
    `feature_service.py`.

    Returns `None` (Bad) on division-by-zero or a non-finite result, exactly
    matching the client's `typeof out === 'number' && Number.isFinite(out)`
    check — a ZeroDivisionError here is a normal Bad cell, not a request
    failure.
    """
    try:
        result = _eval_node(compiled, scope)
    except ZeroDivisionError:
        return None
    return result if math.isfinite(result) else None
