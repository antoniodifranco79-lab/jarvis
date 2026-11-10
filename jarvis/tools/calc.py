from __future__ import annotations

import ast
import math
import operator
import re

from . import ToolContext
from .base import ToolRegistry, ToolResult

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}
_NAMES = {name: getattr(math, name) for name in dir(math) if not name.startswith("_")}
_NAMES.update({"abs": abs, "round": round, "min": min, "max": max, "sum": sum})


def safe_eval(expression: str) -> float | int:
    """Evaluate an arithmetic expression without touching the Python interpreter's namespace."""
    expr = expression.strip().replace("^", "**").replace("×", "*").replace("÷", "/")
    if "." not in expr:  # "3,14" (decimal comma) but not "round(pi, 2)"
        expr = re.sub(r"(?<=\d),(?=\d)", ".", expr)

    def ev(node: ast.AST):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 10_000:
                raise ValueError("exponent too large")
            return _OPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](ev(node.operand))
        if isinstance(node, ast.Name) and node.id in _NAMES and not callable(_NAMES[node.id]):
            return _NAMES[node.id]
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _NAMES:
            return _NAMES[node.func.id](*[ev(a) for a in node.args])
        if isinstance(node, (ast.Tuple, ast.List)):
            return [ev(e) for e in node.elts]
        raise ValueError(f"unsupported expression: {ast.dump(node)[:60]}")

    return ev(ast.parse(expr, mode="eval"))


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool()
    def calculate(expression: str) -> ToolResult:
        """Evaluate a maths expression exactly (arithmetic, powers, roots, trigonometry, logs, percentages
        written as decimals). Call it for any calculation beyond trivial mental arithmetic, unit conversions
        you can express as a formula, tips, splits and compound interest.

        Args:
            expression: e.g. "1234 * 5.5", "sqrt(2) * pi", "150 * 0.22", "2**32".
        """
        try:
            value = safe_eval(expression)
        except (ValueError, SyntaxError, TypeError, ZeroDivisionError, OverflowError) as exc:
            return ToolResult.error(f"Cannot evaluate '{expression}': {exc}")
        if isinstance(value, float) and value.is_integer() and abs(value) < 1e15:
            value = int(value)
        return ToolResult(f"{expression} = {value}")
