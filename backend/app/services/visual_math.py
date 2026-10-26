"""Server twin of the board's safe math language (frontend `mathExpr.ts`): parses and evaluates expressions the
tutor writes into widgets, so an interactive graph or an exercise is checked before the student ever sees it.
Nothing here is ever passed to eval.
"""
import math
import re

FUNCTIONS = ("sin", "cos", "tan", "sqrt", "abs", "ln", "log", "exp")
NAMED = ("pi", "phi", "theta", "alpha", "beta", "gamma", "delta", "lambda", "omega", "sigma", "mu", "rho", "tau")
GREEK = {"π": "pi", "φ": "phi", "ϕ": "phi", "θ": "theta", "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta",
         "λ": "lambda", "ω": "omega", "σ": "sigma", "μ": "mu", "ρ": "rho", "τ": "tau"}
SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")


class MathError(ValueError):
    pass


def _normalise(text: str) -> str:
    s = text.strip().replace("−", "-").replace("–", "-").replace("×", "*").replace("·", "*").replace("÷", "/").replace("**", "^")
    s = re.sub(r"[⁰¹²³⁴⁵⁶⁷⁸⁹]+", lambda m: "^" + m.group(0).translate(SUPERSCRIPTS), s)
    s = "".join(f" {GREEK[c]} " if c in GREEK else c for c in s)
    return re.sub(r"(\d),(\d)", r"\1.\2", s)


def _tokens(text: str) -> list[tuple[str, object]]:
    s, out, i = _normalise(text), [], 0
    names = sorted(FUNCTIONS + NAMED, key=len, reverse=True)
    while i < len(s):
        c = s[i]
        if c.isspace():
            i += 1
        elif c.isdigit() or c == ".":
            m = re.match(r"\d*\.?\d+(e[+-]?\d+)?|\d+\.?", s[i:], re.I)
            out.append(("num", float(m.group(0))))
            i += len(m.group(0))
        elif c.isalpha() and c.isascii():
            word = re.match(r"[a-zA-Z]+", s[i:]).group(0)
            rest = word
            while rest:
                known = next((n for n in names if rest.lower().startswith(n)), None)
                piece = rest[:len(known)] if known else rest[0]
                out.append(("id", known or piece))
                rest = rest[len(piece):]
            i += len(word)
        elif c in "+-*/^()=":
            out.append(("op", c))
            i += 1
        else:
            raise MathError(f"Simbolo non riconosciuto: «{c}»")
    return out


def parse(text: str):
    """Expression (no '=') to a tuple tree: ('num', v) | ('var', name) | ('neg', a) | ('bin', op, a, b) | ('call', fn, a)."""
    tokens, pos = _tokens(text), [0]
    if ("op", "=") in tokens:
        raise MathError("Qui va un'espressione, senza «=»")

    def peek():
        return tokens[pos[0]] if pos[0] < len(tokens) else None

    def take():
        pos[0] += 1
        return tokens[pos[0] - 1]

    def is_op(v):
        return peek() == ("op", v)

    def starts_factor():
        t = peek()
        return t is not None and (t[0] in ("num", "id") or t == ("op", "("))

    def expr():
        a = term()
        while is_op("+") or is_op("-"):
            a = ("bin", take()[1], a, term())
        return a

    def term():
        a = unary()
        while True:
            if is_op("*") or is_op("/"):
                a = ("bin", take()[1], a, unary())
            elif starts_factor():
                a = ("bin", "*", a, power())
            else:
                return a

    def unary():
        if is_op("-"):
            take()
            return ("neg", unary())
        if is_op("+"):
            take()
            return unary()
        return power()

    def power():
        base = atom()
        if is_op("^"):
            take()
            return ("bin", "^", base, unary())
        return base

    def atom():
        t = peek()
        if t is None:
            raise MathError("L'espressione è incompleta")
        take()
        if t[0] == "num":
            return t
        if t[0] == "id":
            if t[1] in FUNCTIONS:
                if is_op("("):
                    take()
                    a = expr()
                    if not is_op(")"):
                        raise MathError(f"Manca una «)» dopo {t[1]}")
                    take()
                    return ("call", t[1], a)
                return ("call", t[1], power())
            if t[1] == "pi":
                return ("num", math.pi)
            if t[1] == "e":
                return ("num", math.e)
            return ("var", t[1])
        if t[1] == "(":
            a = expr()
            if not is_op(")"):
                raise MathError("Manca una parentesi «)»")
            take()
            return a
        raise MathError(f"«{t[1]}» fuori posto")

    tree = expr()
    if pos[0] < len(tokens):
        raise MathError(f"«{tokens[pos[0]][1]}» fuori posto")
    return tree


def variables(node, out=None) -> set[str]:
    out = set() if out is None else out
    if node[0] == "var":
        out.add(node[1])
    elif node[0] in ("neg",):
        variables(node[1], out)
    elif node[0] == "call":
        variables(node[2], out)
    elif node[0] == "bin":
        variables(node[2], out)
        variables(node[3], out)
    return out


def evaluate(node, env: dict[str, float]) -> float:
    kind = node[0]
    if kind == "num":
        return node[1]
    if kind == "var":
        if node[1] not in env:
            raise MathError(f"Non so quanto vale «{node[1]}»")
        return env[node[1]]
    if kind == "neg":
        return -evaluate(node[1], env)
    if kind == "call":
        a = evaluate(node[2], env)
        fn = {"sin": math.sin, "cos": math.cos, "tan": math.tan, "sqrt": math.sqrt, "abs": abs, "exp": math.exp,
              "log": math.log10, "ln": math.log}[node[1]]
        return fn(a)
    a, b = evaluate(node[2], env), evaluate(node[3], env)
    op = node[1]
    return a + b if op == "+" else a - b if op == "-" else a * b if op == "*" else a / b if op == "/" else a ** b


def parse_equation(text: str):
    """'y = …', 'F(x,y) = G(x,y)' or a bare expression in x (meaning y = …): returns F with F(x, y) = 0."""
    sides = _normalise(text).split("=")
    if len(sides) > 2:
        raise MathError("Usa un solo «=»")
    if len(sides) == 1 or not sides[0].strip():
        return ("bin", "-", ("var", "y"), parse(sides[-1]))
    if not sides[1].strip():
        raise MathError("Manca il secondo membro dopo «=»")
    return ("bin", "-", parse(sides[0]), parse(sides[1]))


def drawable(f, env: dict[str, float], window: tuple[float, float, float, float]) -> bool:
    """True if F(x, y) = 0 crosses the window somewhere (sign change on a coarse grid)."""
    x0, x1, y0, y1 = window
    signs = set()
    for i in range(41):
        for j in range(41):
            try:
                v = evaluate(f, {**env, "x": x0 + (x1 - x0) * i / 40, "y": y0 + (y1 - y0) * j / 40})
            except (ArithmeticError, ValueError):
                continue
            if math.isfinite(v):
                signs.add(v > 0)
            if len(signs) == 2:
                return True
    return False


# --- conic families: the same algebra as the board's classifier, enough to check what a widget draws -------------

def _poly(node, env):
    """Polynomial in x, y as {(i, j): coefficient}, or None if the expression is not polynomial."""
    kind = node[0]
    if kind == "num":
        return {(0, 0): node[1]}
    if kind == "var":
        if node[1] == "x":
            return {(1, 0): 1.0}
        if node[1] == "y":
            return {(0, 1): 1.0}
        return {(0, 0): env[node[1]]} if node[1] in env else None
    if kind == "neg":
        p = _poly(node[1], env)
        return p and {k: -v for k, v in p.items()}
    if kind == "call":
        return None
    a, b = _poly(node[2], env), _poly(node[3], env)
    if a is None or b is None:
        return None
    op = node[1]
    if op in "+-":
        out = dict(a)
        for k, v in b.items():
            out[k] = out.get(k, 0) + (v if op == "+" else -v)
        return out
    if op == "*":
        return _mul(a, b)
    constant = b.get((0, 0)) if set(b) <= {(0, 0)} else None
    if op == "/":
        return {k: v / constant for k, v in a.items()} if constant else None
    if constant is None or constant != int(constant) or not 0 <= constant <= 4:
        return None
    out = {(0, 0): 1.0}
    for _ in range(int(constant)):
        out = _mul(out, a)
    return out


def _mul(a, b):
    out = {}
    for (i1, j1), va in a.items():
        for (i2, j2), vb in b.items():
            out[(i1 + i2, j1 + j2)] = out.get((i1 + i2, j1 + j2), 0) + va * vb
    return out


def family(equation: str, env: dict[str, float] | None = None) -> str:
    """retta | parabola | circonferenza | ellisse | iperbole | altro (non polinomiale o di grado > 2)."""
    p = _poly(parse_equation(equation), env or {})
    if p is None:
        return "altro"
    p = {k: v for k, v in p.items() if abs(v) > 1e-9}
    degree = max((i + j for i, j in p), default=0)
    if degree == 1:
        return "retta"
    if degree != 2:
        return "altro"
    a, b, c = p.get((2, 0), 0), p.get((1, 1), 0), p.get((0, 2), 0)
    disc = b * b - 4 * a * c
    if abs(disc) < 1e-9:
        return "parabola"
    if disc > 0:
        return "iperbole"
    return "circonferenza" if abs(a - c) < 1e-9 and abs(b) < 1e-9 else "ellisse"
