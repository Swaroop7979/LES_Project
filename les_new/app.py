"""
Linear Equation System Solver - Flask Backend
Uses the Rank Method (Gaussian Elimination) to solve systems of linear equations.
"""

import os
from dotenv import load_dotenv
load_dotenv()
import json
import random
import warnings
from datetime import datetime, timezone
from functools import wraps
from fractions import Fraction

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from werkzeug.security import generate_password_hash, check_password_hash
import numpy as np

app = Flask(__name__)

# ── Issue #20: Fail loudly if secret key not set in production ──
app.secret_key = os.environ.get("LES_SECRET_KEY")
if not app.secret_key:
    warnings.warn(
        "LES_SECRET_KEY not set — using insecure default. Set this env var in production.",
        stacklevel=2,
    )
    app.secret_key = "les_dev_secret_change_in_prod"

app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL", "sqlite:///les_users.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


# ─────────────────────────────────────────────
#  Database Models
# ─────────────────────────────────────────────

# Issue #13: Use timezone-aware UTC timestamps
def _utcnow():
    return datetime.now(timezone.utc)


class User(db.Model):
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at    = db.Column(db.DateTime, default=_utcnow)
    attempts      = db.relationship("QuizAttempt", backref="user", lazy=True)


class QuizAttempt(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    timestamp   = db.Column(db.DateTime, default=_utcnow)
    n_eq        = db.Column(db.Integer)
    n_var       = db.Column(db.Integer)
    sol_type    = db.Column(db.String(20))
    scores      = db.Column(db.Text)
    total       = db.Column(db.Float)
    hint_counts = db.Column(db.Text)


class MCQAttempt(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    user_id   = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    timestamp = db.Column(db.DateTime, default=_utcnow)
    score     = db.Column(db.Integer)
    answers   = db.Column(db.Text)


# ─────────────────────────────────────────────
#  Issue #24: Single module-level constant for quiz card keys
# ─────────────────────────────────────────────
QUIZ_CARDS = ["aug_matrix", "rank", "sol_type", "final_answer"]


# ─────────────────────────────────────────────
#  Auth helpers
# ─────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("user_id"):
            if request.path.startswith("/api/"):
                return jsonify({"ok": False, "error": "not_authenticated"}), 401
            return redirect(url_for("home"))
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────────────────────────
#  Math helpers
# ─────────────────────────────────────────────

def gaussian_elimination(matrix):
    mat = [row[:] for row in matrix]
    rows = len(mat)
    cols = len(mat[0])
    pivot_cols = []
    row_idx = 0

    for col in range(cols - 1):
        pivot = None
        for r in range(row_idx, rows):
            if abs(mat[r][col]) > 1e-10:
                pivot = r
                break
        if pivot is None:
            continue
        mat[row_idx], mat[pivot] = mat[pivot], mat[row_idx]
        pivot_cols.append(col)
        for r in range(rows):
            if r != row_idx and abs(mat[r][col]) > 1e-10:
                factor = mat[r][col] / mat[row_idx][col]
                for c in range(cols):
                    mat[r][c] -= factor * mat[row_idx][c]
        row_idx += 1
        if row_idx >= rows:
            break

    return mat, pivot_cols


def compute_rank(matrix):
    if not matrix or not matrix[0]:
        return 0
    mat = np.array(matrix, dtype=float)
    return int(np.linalg.matrix_rank(mat))


def classify_solution(coeff_matrix, aug_matrix):
    n_vars     = len(coeff_matrix[0])
    rank_coeff = compute_rank(coeff_matrix)
    rank_aug   = compute_rank(aug_matrix)
    if rank_coeff != rank_aug:
        return "none"
    elif rank_coeff == n_vars:
        return "unique"
    else:
        return "infinite"


# Issue #3: Guard against non-square / under-determined systems
def solve_unique(aug_matrix):
    solved, pivot_cols = gaussian_elimination(aug_matrix)
    n_vars  = len(aug_matrix[0]) - 1
    n_rows  = len(solved)
    solution = {}
    for i in range(min(n_vars, n_rows)):
        if i < len(pivot_cols):
            pc = pivot_cols[i]
            if abs(solved[i][pc]) > 1e-10:
                solution[pc] = round(solved[i][-1] / solved[i][pc], 6)
            else:
                solution[pc] = 0.0
    # Fill any remaining variables with 0
    for i in range(n_vars):
        if i not in solution:
            solution[i] = 0.0
    return solution


# Issue #4: Guard against no free columns and ZeroDivisionError
def solve_infinite(aug_matrix, n_vars):
    solved, pivot_cols = gaussian_elimination(aug_matrix)
    free_cols = [c for c in range(n_vars) if c not in pivot_cols]

    # Defensive: if somehow no free cols, return neutral result
    if not free_cols:
        return [(0, 0)] * n_vars, 0

    free_var = free_cols[0]
    result = []

    for var in range(n_vars):
        if var == free_var:
            result.append(("free", 0))
            continue
        row = None
        for r, pc in enumerate(pivot_cols):
            if pc == var:
                row = r
                break
        if row is None:
            result.append((0, 0))
            continue
        pivot_val = solved[row][var]
        if abs(pivot_val) < 1e-10:
            result.append((0, 0))
            continue
        try:
            constant = solved[row][-1] / pivot_val
            coeff    = -solved[row][free_var] / pivot_val if free_var < n_vars else 0
        except ZeroDivisionError:
            constant, coeff = 0.0, 0.0
        result.append((round(coeff, 6), round(constant, 6)))

    return result, free_var


def build_step_by_step(aug_matrix):
    steps = []
    mat = [row[:] for row in aug_matrix]
    rows = len(mat)
    cols = len(mat[0])
    row_idx = 0

    steps.append(("Initial augmented matrix", [row[:] for row in mat]))

    for col in range(cols - 1):
        pivot = None
        for r in range(row_idx, rows):
            if abs(mat[r][col]) > 1e-10:
                pivot = r
                break
        if pivot is None:
            continue
        if pivot != row_idx:
            mat[row_idx], mat[pivot] = mat[pivot], mat[row_idx]
            steps.append((f"Swap R{row_idx+1} ↔ R{pivot+1}", [row[:] for row in mat]))
        for r in range(rows):
            if r != row_idx and abs(mat[r][col]) > 1e-10:
                factor = mat[r][col] / mat[row_idx][col]
                factor_str = _fmt(factor)
                for c in range(cols):
                    mat[r][c] -= factor * mat[row_idx][c]
                steps.append(
                    (f"R{r+1} → R{r+1} − ({factor_str})×R{row_idx+1}",
                     [row[:] for row in mat])
                )
        row_idx += 1
        if row_idx >= rows:
            break

    steps.append(("Row echelon form", [row[:] for row in mat]))
    return steps


def _fmt(val):
    if abs(val - round(val)) < 1e-9:
        return str(int(round(val)))
    try:
        f = Fraction(val).limit_denominator(100)
        if f.denominator > 1:
            return f"{f.numerator}/{f.denominator}"
        return str(f.numerator)
    except:
        pass
    return f"{val:.4f}".rstrip('0').rstrip('.')


# ─────────────────────────────────────────────
#  Auth Routes
# ─────────────────────────────────────────────

@app.route("/api/auth/signup", methods=["POST"])
def auth_signup():
    data     = request.json
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    confirm  = data.get("confirm") or ""

    # Issue #16: Return proper HTTP status codes for auth errors
    if not username or not password:
        return jsonify({"ok": False, "error": "Username and password are required."}), 400
    if len(username) < 3:
        return jsonify({"ok": False, "error": "Username must be at least 3 characters."}), 400
    if len(password) < 4:
        return jsonify({"ok": False, "error": "Password must be at least 4 characters."}), 400
    if password != confirm:
        return jsonify({"ok": False, "error": "Passwords do not match."}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"ok": False, "error": "Username already taken."}), 409

    user = User(username=username, password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()

    session["user_id"]  = user.id
    session["username"] = user.username
    return jsonify({"ok": True, "username": user.username})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data     = request.json
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""

    user = User.query.filter_by(username=username).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"ok": False, "error": "Invalid username or password."}), 401

    session["user_id"]  = user.id
    session["username"] = user.username
    return jsonify({"ok": True, "username": user.username})


@app.route("/api/auth/logout", methods=["GET", "POST"])
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/status")
def auth_status():
    return jsonify({
        "logged_in": bool(session.get("user_id")),
        "username":  session.get("username")
    })


# ─────────────────────────────────────────────
#  Page Routes
# ─────────────────────────────────────────────

@app.route("/")
def home():
    return render_template("home.html")


@app.route("/quiz")
@login_required
def quiz():
    quiz_keys = ["n_eq", "n_var", "coeff_matrix", "aug_matrix", "scores",
                 "steps", "sol_type", "rank_coeff", "rank_aug",
                 "unique_sol", "inf_sol", "free_var", "hint_counts",
                 "attempt_saved"]
    for k in quiz_keys:
        session.pop(k, None)
    return render_template("index.html")


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")


@app.route("/progress")
@login_required
def progress():
    return render_template("progress.html")


@app.route("/api/progress/data")
@login_required
def progress_data():
    """Return rich analytics for the My Progress page."""
    user_id  = session.get("user_id")
    attempts = QuizAttempt.query.filter_by(user_id=user_id)\
                                .order_by(QuizAttempt.timestamp).all()

    result = []
    for a in attempts:
        scores      = json.loads(a.scores      or "{}")
        hint_counts = json.loads(a.hint_counts or "{}")
        result.append({
            "id":           a.id,
            "timestamp":    a.timestamp.strftime("%b %d, %Y %H:%M") if a.timestamp else "",
            "timestamp_ts": a.timestamp.timestamp() if a.timestamp else 0,
            "n_eq":         a.n_eq,
            "n_var":        a.n_var,
            "sol_type":     a.sol_type,
            "scores":       scores,
            "total":        a.total,
            "hint_counts":  hint_counts,
        })

    if not result:
        return jsonify({"attempts": [], "aggregate": {}})

    totals = [r["total"] for r in result if r["total"] is not None]

    # Per-card averages and first-try rates — uses QUIZ_CARDS constant (Issue #24)
    card_stats = {}
    for c in QUIZ_CARDS:
        vals      = [r["scores"].get(c) for r in result if r["scores"].get(c) is not None]
        # Issue #7: first_try_pct — correctly named, documents the 5.0 = attempt 1, no hint contract
        first_try = [v for v in vals if v == 5.0]
        card_stats[c] = {
            "avg":           round(sum(vals) / len(vals), 2) if vals else None,
            "first_try_pct": round(len(first_try) / len(vals) * 100, 1) if vals else None,
            "hint_total":    sum(r["hint_counts"].get(c, 0) for r in result),
        }

    improvement = round(totals[-1] - totals[0], 2) if len(totals) >= 2 else 0

    scored_cards = {c: s["avg"] for c, s in card_stats.items() if s["avg"] is not None}
    weakest   = min(scored_cards, key=scored_cards.get) if scored_cards else None
    strongest = max(scored_cards, key=scored_cards.get) if scored_cards else None

    sol_perf = {}
    for r in result:
        st = r["sol_type"]
        if st:
            sol_perf.setdefault(st, []).append(r["total"] or 0)
    sol_avg = {k: round(sum(v)/len(v), 2) for k, v in sol_perf.items()}

    hint_free_streak = 0
    for r in reversed(result):
        if all(v == 0 for v in r["hint_counts"].values()):
            hint_free_streak += 1
        else:
            break

    prev_total = result[-2]["total"] if len(result) >= 2 else None

    aggregate = {
        "total_attempts":   len(result),
        "best_score":       round(max(totals), 2) if totals else None,
        "avg_score":        round(sum(totals) / len(totals), 2) if totals else None,
        "improvement":      improvement,
        "card_stats":       card_stats,
        "weakest_card":     weakest,
        "strongest_card":   strongest,
        "sol_type_avg":     sol_avg,
        "hint_free_streak": hint_free_streak,
        "prev_total":       prev_total,
    }

    return jsonify({"attempts": result, "aggregate": aggregate})


# ─────────────────────────────────────────────
#  Quiz API Routes
# ─────────────────────────────────────────────

@app.route("/api/set_config", methods=["POST"])
@login_required
def set_config():
    data  = request.json
    n_eq  = int(data.get("equations", 0))
    n_var = int(data.get("variables", 0))

    if not (2 <= n_eq <= 5) or not (2 <= n_var <= 5):
        return jsonify({"ok": False, "error": "Size must be between 2 and 5."}), 400

    session["n_eq"]        = n_eq
    session["n_var"]       = n_var
    session["scores"]      = {}
    session["hint_counts"] = {}
    return jsonify({"ok": True, "n_eq": n_eq, "n_var": n_var})


@app.route("/api/set_equations", methods=["POST"])
@login_required
def set_equations():
    data   = request.json
    n_eq   = session.get("n_eq")
    n_var  = session.get("n_var")
    coeffs = data.get("coefficients")

    if not coeffs or len(coeffs) != n_eq:
        return jsonify({"ok": False, "error": "Invalid data."}), 400

    coeff_matrix = [row[:n_var]   for row in coeffs]
    aug_matrix   = [row[:n_var+1] for row in coeffs]

    # Issue #18: Validate for all-zero rows (would cause ZeroDivisionError downstream)
    for idx, row in enumerate(coeff_matrix):
        if all(abs(v) < 1e-10 for v in row):
            const = aug_matrix[idx][-1]
            if abs(const) > 1e-10:
                return jsonify({
                    "ok": False,
                    "error": f"Row {idx + 1} has all-zero coefficients with a non-zero constant — inconsistent equation."
                }), 400
            # All-zero row with zero constant is redundant — allowed, just skip

    session["coeff_matrix"] = coeff_matrix
    session["aug_matrix"]   = aug_matrix

    rank_c   = compute_rank(coeff_matrix)
    rank_a   = compute_rank(aug_matrix)
    sol_type = classify_solution(coeff_matrix, aug_matrix)

    session["rank_coeff"] = rank_c
    session["rank_aug"]   = rank_a
    session["sol_type"]   = sol_type

    if sol_type == "unique":
        session["unique_sol"] = solve_unique(aug_matrix)
    elif sol_type == "infinite":
        inf_sol, free_var = solve_infinite(aug_matrix, n_var)
        session["inf_sol"]  = inf_sol
        session["free_var"] = free_var

    steps = build_step_by_step(aug_matrix)
    session["steps"] = [(desc, matrix) for desc, matrix in steps]

    return jsonify({"ok": True, "sol_type": sol_type})


@app.route("/api/quiz/augmented_matrix", methods=["POST"])
@login_required
def quiz_augmented_matrix():
    data        = request.json
    user_matrix = data.get("matrix")
    correct     = session.get("aug_matrix")
    attempt     = int(data.get("attempt", 1))

    if not user_matrix or not correct:
        return jsonify({"ok": False, "error": "No data."}), 400

    results     = []
    all_correct = True
    for i, row in enumerate(correct):
        row_res = []
        for j, val in enumerate(row):
            try:
                uval = float(user_matrix[i][j])
            except (ValueError, TypeError):
                uval = None
            correct_cell = abs(uval - val) <= 0.01 if uval is not None else False
            if not correct_cell:
                all_correct = False
            row_res.append(correct_cell)
        results.append(row_res)

    score = _compute_score("aug_matrix", all_correct, attempt, data.get("used_hint", False))
    return jsonify({"ok": True, "results": results, "all_correct": all_correct,
                    "score": score, "correct_matrix": correct})


@app.route("/api/quiz/rank", methods=["POST"])
@login_required
def quiz_rank():
    data    = request.json
    attempt = int(data.get("attempt", 1))

    try:
        user_rc = int(data.get("rank_coeff"))
        user_ra = int(data.get("rank_aug"))
    except (ValueError, TypeError):
        return jsonify({"ok": False, "error": "Enter numeric values."}), 400

    correct_rc  = session.get("rank_coeff")
    correct_ra  = session.get("rank_aug")
    rc_correct  = (user_rc == correct_rc)
    ra_correct  = (user_ra == correct_ra)
    all_correct = rc_correct and ra_correct

    score = _compute_score("rank", all_correct, attempt, data.get("used_hint", False))
    return jsonify({
        "ok": True,
        "rc_correct": rc_correct, "ra_correct": ra_correct,
        "all_correct": all_correct,
        "correct_rc": correct_rc, "correct_ra": correct_ra,
        "score": score
    })


@app.route("/api/quiz/solution_type", methods=["POST"])
@login_required
def quiz_solution_type():
    data        = request.json
    attempt     = int(data.get("attempt", 1))
    user_answer = data.get("answer")
    correct     = session.get("sol_type")
    all_correct = (user_answer == correct)
    score       = _compute_score("sol_type", all_correct, attempt, data.get("used_hint", False))
    return jsonify({"ok": True, "all_correct": all_correct, "correct": correct, "score": score})


def parse_fraction_or_decimal(val_str):
    if not val_str:
        raise ValueError("Empty string")
    val_str = str(val_str).strip()
    if "/" in val_str:
        num, den = val_str.split("/", 1)
        return float(num) / float(den)
    return float(val_str)


@app.route("/api/quiz/final_answer", methods=["POST"])
@login_required
def quiz_final_answer():
    data     = request.json
    attempt  = int(data.get("attempt", 1))
    sol_type = session.get("sol_type")

    if sol_type == "none":
        score = _compute_score("final_answer", True, 1, False)
        return jsonify({"ok": True, "all_correct": True, "score": score})

    all_correct = False

    if sol_type == "unique":
        correct   = session.get("unique_sol", {})
        user_vals = data.get("values", {})
        results   = {}
        all_correct = True
        for k, cv in correct.items():
            try:
                uv = parse_fraction_or_decimal(user_vals.get(str(k), ""))
            except (ValueError, TypeError, ZeroDivisionError):
                uv = None
            ok = uv is not None and abs(uv - cv) <= 0.01
            if not ok:
                all_correct = False
            results[k] = {"user": uv, "correct": cv, "ok": ok}
        score = _compute_score("final_answer", all_correct, attempt, data.get("used_hint", False))
        return jsonify({"ok": True, "all_correct": all_correct, "results": results, "score": score})

    elif sol_type == "infinite":
        inf_sol      = session.get("inf_sol", [])
        free_var     = session.get("free_var", 0)
        n_var        = session.get("n_var")
        aug_matrix   = session.get("aug_matrix")
        user_vals    = data.get("values", {})
        results      = {}

        user_coeffs = []
        user_consts = []
        parse_ok    = True
        for i in range(n_var):
            if i == free_var:
                user_coeffs.append(1.0)
                user_consts.append(0.0)
            else:
                try:
                    c = parse_fraction_or_decimal(user_vals.get(f"{i}_coeff", ""))
                    k = parse_fraction_or_decimal(user_vals.get(f"{i}_const", ""))
                    user_coeffs.append(c)
                    user_consts.append(k)
                except (ValueError, TypeError, ZeroDivisionError):
                    user_coeffs.append(None)
                    user_consts.append(None)
                    parse_ok = False

        all_correct = parse_ok
        if parse_ok:
            if all(abs(c) < 1e-5 for c in user_coeffs):
                all_correct = False

            if all_correct:
                test_values = [0, 1, -1, 2, -2, 0.5]
                A = [row[:n_var] for row in aug_matrix]
                b = [row[-1] for row in aug_matrix]
                for t in test_values:
                    x = [user_coeffs[i] * t + user_consts[i] for i in range(n_var)]
                    for row_idx, a_row in enumerate(A):
                        lhs = sum(a_row[j] * x[j] for j in range(n_var))
                        if abs(lhs - b[row_idx]) > 0.05:
                            all_correct = False
                            break
                    if not all_correct:
                        break

        for i, entry in enumerate(inf_sol):
            if entry[0] == "free":
                results[i] = {"free": True}
                continue
            corr_coeff, corr_const = entry
            u_coeff = user_coeffs[i]
            u_const = user_consts[i]
            ok = all_correct
            results[i] = {
                "corr_coeff": _fmt(corr_coeff), "corr_const": _fmt(corr_const),
                "user_coeff": u_coeff,    "user_const": u_const, "ok": ok
            }

        score = _compute_score("final_answer", all_correct, attempt, data.get("used_hint", False))
        return jsonify({"ok": True, "all_correct": all_correct, "results": results, "score": score})

    return jsonify({"ok": False, "error": "Unknown solution type."}), 400


@app.route("/api/get_results", methods=["GET"])
@login_required
def get_results():
    scores = session.get("scores", {})
    total  = sum(scores.values())

    steps_raw = session.get("steps", [])
    steps = []
    for desc, mat in steps_raw:
        fmt_mat = [[_fmt(v) for v in row] for row in mat]
        steps.append({"desc": desc, "matrix": fmt_mat})

    sol_type   = session.get("sol_type")
    n_var      = session.get("n_var", 0)
    unique_sol = session.get("unique_sol", {})
    inf_sol    = session.get("inf_sol", [])
    free_var   = session.get("free_var", None)
    aug_matrix = session.get("aug_matrix", [])

    user_id    = session.get("user_id")
    prev_total = None
    if user_id and sol_type and not session.get("attempt_saved"):
        hint_counts = session.get("hint_counts", {})

        last = QuizAttempt.query.filter_by(user_id=user_id)\
                                .order_by(QuizAttempt.timestamp.desc()).first()
        if last and last.total is not None:
            prev_total = last.total

        attempt = QuizAttempt(
            user_id     = user_id,
            n_eq        = session.get("n_eq"),
            n_var       = n_var,
            sol_type    = sol_type,
            scores      = json.dumps(scores),
            total       = total,
            hint_counts = json.dumps(hint_counts)
        )
        db.session.add(attempt)
        db.session.commit()
        session["attempt_saved"] = True

    return jsonify({
        "ok": True,
        "scores":     scores,
        "total":      total,
        "prev_total": prev_total,
        "steps":      steps,
        "sol_type":   sol_type,
        "n_var":      n_var,
        "unique_sol": {str(k): _fmt(v) for k, v in unique_sol.items()},
        "inf_sol":    [["free"] if e[0] == "free" else [_fmt(e[0]), _fmt(e[1])] for e in inf_sol],
        "free_var":   free_var,
        "aug_matrix": [[_fmt(v) for v in row] for row in aug_matrix],
        "rank_coeff": session.get("rank_coeff"),
        "rank_aug":   session.get("rank_aug"),
    })


@app.route("/api/get_hint/<quiz>", methods=["GET"])
@login_required
def get_hint(quiz):
    hint_counts = session.get("hint_counts", {})
    hint_counts[quiz] = hint_counts.get(quiz, 0) + 1
    session["hint_counts"] = hint_counts

    n_var      = session.get("n_var", 0)
    aug_matrix = session.get("aug_matrix", [])

    def var_name(i):
        subs = "₀₁₂₃₄₅₆₇₈₉"
        return "x" + "".join(subs[int(d)] for d in str(i + 1))

    if quiz == "augmented_matrix":
        correct = aug_matrix
        explanation = (
            "An augmented matrix combines the coefficients and constants of your equations into a single grid.<br><br>"
            "• <strong>Left side:</strong> Copy the coefficients of your variables.<br>"
            "• <strong>Right side (after separator):</strong> Copy the constants from the right side of the equals sign."
        )
        return jsonify({"correct_matrix": correct, "explanation": explanation})

    elif quiz == "rank":
        rank_coeff = session.get("rank_coeff")
        rank_aug   = session.get("rank_aug")
        explanation = (
            "To determine the rank, you convert the matrix into Row Echelon Form (REF) and count the number of non-zero rows.<br><br>"
            "• <strong>Rank(A)</strong>: Count the non-zero rows ignoring the constants column.<br>"
            "• <strong>Rank([A|b])</strong>: Count the non-zero rows of the entire augmented matrix.<br><br>"
            f"Based on the REF, <strong>Rank(A) = {rank_coeff}</strong> and <strong>Rank([A|b]) = {rank_aug}</strong>."
        )
        return jsonify({"rank_coeff": rank_coeff, "rank_aug": rank_aug, "explanation": explanation})

    elif quiz == "solution_type":
        sol        = session.get("sol_type")
        rank_coeff = session.get("rank_coeff")
        rank_aug   = session.get("rank_aug")
        labels     = {"unique": "Unique Solution", "infinite": "Infinite Solutions", "none": "No Solution"}
        rules      = {
            "none":     f"Because Rank(A) [{rank_coeff}] ≠ Rank([A|b]) [{rank_aug}], the system has <strong>No Solution</strong>.",
            "unique":   f"Because Rank(A) = Rank([A|b]) = Number of Variables ({n_var}), the system has a <strong>Unique Solution</strong>.",
            "infinite": f"Because Rank(A) = Rank([A|b]) = {rank_coeff}, but this is less than the Number of Variables ({n_var}), the system has <strong>Infinite Solutions</strong>."
        }
        return jsonify({"correct": sol, "label": labels.get(sol, sol), "explanation": rules.get(sol, "")})

    elif quiz == "final_answer":
        sol_type = session.get("sol_type")
        if sol_type == "unique":
            unique_sol = session.get("unique_sol", {})
            explanation = (
                "To find the final answer, use <strong>back-substitution</strong> from the Row Echelon Form (REF).<br><br>"
                "Start from the bottom equation, solve for the variable, and substitute it into the equations above."
            )
            return jsonify({
                "sol_type": sol_type,
                "unique_sol": {str(k): _fmt(v) for k, v in unique_sol.items()},
                "explanation": explanation
            })
        elif sol_type == "infinite":
            inf_sol  = session.get("inf_sol", [])
            free_var = session.get("free_var")
            explanation = (
                "For infinite solutions, express the pivot variables in terms of the free variable (z).<br><br>"
                "Move the free variable to the right side of the equations to form your parametric solution."
            )
            fmt_inf_sol = [["free"] if e[0] == "free" else [_fmt(e[0]), _fmt(e[1])] for e in inf_sol]
            return jsonify({"sol_type": sol_type, "inf_sol": fmt_inf_sol, "free_var": free_var, "explanation": explanation})
        return jsonify({"sol_type": sol_type, "explanation": "No solution — this system is inconsistent."})

    return jsonify({"explanation": "No hint available."})


# Issue #5: Separate endpoint that returns infinite-solution structure WITHOUT incrementing hint counter
@app.route("/api/quiz/infinite_structure")
@login_required
def infinite_structure():
    inf_sol = session.get("inf_sol", [])
    structure = [{"is_free": entry[0] == "free"} for entry in inf_sol]
    return jsonify({"structure": structure, "inf_sol": inf_sol})


# ─────────────────────────────────────────────
#  Dashboard API
# ─────────────────────────────────────────────

@app.route("/api/leaderboard")
@login_required
def leaderboard():
    """Issue #17: Single aggregation query — no N+1 problem."""
    current_uid = session.get("user_id")

    stats = db.session.query(
        User.id,
        User.username,
        func.max(QuizAttempt.total).label("best"),
        func.avg(QuizAttempt.total).label("avg"),
        func.count(QuizAttempt.id).label("attempts"),
    ).join(QuizAttempt).group_by(User.id)\
     .having(func.count(QuizAttempt.id) >= 3).all()

    board = []
    for s in stats:
        ranking_score = round(float(s.avg or 0) * 0.7 + float(s.best or 0) * 0.3, 2)
        board.append({
            "username":      s.username,
            "best":          round(float(s.best or 0), 1),
            "avg":           round(float(s.avg or 0), 1),
            "attempts":      s.attempts,
            "ranking_score": ranking_score,
            "is_me":         (s.id == current_uid),
        })

    board.sort(key=lambda x: (-x["ranking_score"], -x["best"], x["attempts"]))
    for i, entry in enumerate(board):
        entry["rank"] = i + 1
    return jsonify(board[:50])


@app.route("/api/dashboard/data")
@login_required
def dashboard_data():
    user_id  = session.get("user_id")
    attempts = QuizAttempt.query.filter_by(user_id=user_id)\
                                .order_by(QuizAttempt.timestamp).all()
    result = []
    for a in attempts:
        result.append({
            "scores":      json.loads(a.scores      or "{}"),
            "total":       a.total,
            "sol_type":    a.sol_type,
            "hint_counts": json.loads(a.hint_counts or "{}"),
            "n_eq":        a.n_eq,
            "n_var":       a.n_var,
            "timestamp":   a.timestamp.strftime("%b %d, %Y") if a.timestamp else ""
        })
    return jsonify(result)


# ─────────────────────────────────────────────
#  MCQ Theory Test Routes
# ─────────────────────────────────────────────

MCQ_BANK = [
    {
        "id": 1, "topic": "Augmented Matrix",
        "q": "Which of the following correctly represents the augmented matrix [A|b] for a system Ax = b?",
        "options": [
            "A matrix containing only the coefficients of the variables",
            "A matrix formed by appending the constant vector b to the coefficient matrix A",
            "The transpose of the coefficient matrix",
            "A diagonal matrix of the system"
        ],
        "answer": 1,
        "explain": "The augmented matrix [A|b] is formed by appending the constant vector b as the last column of the coefficient matrix A."
    },
    {
        "id": 2, "topic": "Rank",
        "q": "The rank of a matrix is defined as:",
        "options": [
            "The number of columns in the matrix",
            "The number of zero rows after row reduction",
            "The number of linearly independent rows (or columns)",
            "The determinant of the matrix"
        ],
        "answer": 2,
        "explain": "Rank is the number of linearly independent rows or columns, equivalently the number of non-zero rows in row echelon form."
    },
    {
        "id": 3, "topic": "Solution Types",
        "q": "A system Ax = b has NO solution when:",
        "options": [
            "rank(A) = rank([A|b]) = n",
            "rank(A) = rank([A|b]) < n",
            "rank(A) ≠ rank([A|b])",
            "rank(A) > number of equations"
        ],
        "answer": 2,
        "explain": "When rank(A) ≠ rank([A|b]), the system is inconsistent — the constant vector b is not in the column space of A, so no solution exists."
    },
    {
        "id": 4, "topic": "Solution Types",
        "q": "A system has infinitely many solutions when:",
        "options": [
            "rank(A) ≠ rank([A|b])",
            "rank(A) = rank([A|b]) = n (number of variables)",
            "rank(A) = rank([A|b]) < n (number of variables)",
            "The coefficient matrix is square"
        ],
        "answer": 2,
        "explain": "When rank(A) = rank([A|b]) but both are less than n (number of variables), there are free variables, leading to infinitely many solutions."
    },
    {
        "id": 5, "topic": "Gaussian Elimination",
        "q": "Which row operation is NOT valid in Gaussian elimination?",
        "options": [
            "Swapping two rows",
            "Multiplying a row by a non-zero scalar",
            "Adding a multiple of one row to another",
            "Multiplying two rows together"
        ],
        "answer": 3,
        "explain": "The three valid elementary row operations are: swapping rows, scaling a row by a non-zero scalar, and adding a multiple of one row to another. Multiplying rows together is not a valid operation."
    },
    {
        "id": 6, "topic": "Unique Solution",
        "q": "For a unique solution to exist in a system of n equations with n unknowns, which condition must hold?",
        "options": [
            "The determinant of A must be zero",
            "rank(A) = n and rank([A|b]) = n",
            "The system must be homogeneous (b = 0)",
            "The number of equations must exceed the number of unknowns"
        ],
        "answer": 1,
        "explain": "A unique solution exists when rank(A) = rank([A|b]) = n, meaning the coefficient matrix has full rank and the system is consistent."
    },
    {
        "id": 7, "topic": "Row Echelon Form",
        "q": "In Row Echelon Form (REF), which property must hold?",
        "options": [
            "All entries above and below pivots are zero",
            "All zero rows appear at the top",
            "Each pivot is to the right of the pivot in the row above it",
            "All pivot entries must equal 1"
        ],
        "answer": 2,
        "explain": "In REF, each leading entry (pivot) must be strictly to the right of the leading entry in the row above. Zero rows appear at the bottom. RREF additionally requires pivots to be 1 with zeros above and below."
    },
    {
        "id": 8, "topic": "Free Variables",
        "q": "Free variables in a system arise when:",
        "options": [
            "rank(A) equals the number of variables",
            "rank(A) is less than the number of variables",
            "The system has no solution",
            "Every equation has a unique pivot"
        ],
        "answer": 1,
        "explain": "When rank(A) < n (number of variables), not every variable has a pivot column, so the remaining variables are 'free' and can take any value."
    },
    {
        "id": 9, "topic": "Homogeneous Systems",
        "q": "A homogeneous system Ax = 0 always has:",
        "options": [
            "Only the trivial solution x = 0",
            "Infinitely many solutions",
            "At least one solution (the trivial solution x = 0)",
            "No solution if rank(A) < n"
        ],
        "answer": 2,
        "explain": "A homogeneous system always has at least the trivial solution x = 0. It has infinitely many solutions only when rank(A) < n."
    },
    {
        "id": 10, "topic": "Matrix Rank",
        "q": "If A is a 3×4 matrix, what is the maximum possible rank of A?",
        "options": ["4", "3", "7", "12"],
        "answer": 1,
        "explain": "The rank of a matrix cannot exceed the minimum of its number of rows and columns. For a 3×4 matrix, max rank = min(3,4) = 3."
    },
    {
        "id": 11, "topic": "Consistency",
        "q": "A system Ax = b is called consistent when:",
        "options": [
            "rank(A) ≠ rank([A|b])",
            "rank(A) = rank([A|b])",
            "A has more rows than columns",
            "The determinant of A is non-zero"
        ],
        "answer": 1,
        "explain": "A system is consistent (has at least one solution) if and only if rank(A) = rank([A|b]) — the constant vector b doesn't introduce a new dependency."
    },
    {
        "id": 12, "topic": "Gaussian Elimination",
        "q": "What is the primary goal of Gaussian elimination?",
        "options": [
            "To find the determinant of the matrix",
            "To transform the augmented matrix into row echelon form",
            "To find the inverse of the matrix",
            "To compute the rank without row operations"
        ],
        "answer": 1,
        "explain": "Gaussian elimination uses elementary row operations to transform the augmented matrix into row echelon form, from which the solution can be read by back-substitution."
    },
]


@app.route("/mcq")
@login_required
def mcq_page():
    return render_template("mcq.html")


@app.route("/api/mcq/questions")
@login_required
def mcq_questions():
    """Return 5 randomly selected questions (without answers)."""
    selected  = random.sample(MCQ_BANK, min(5, len(MCQ_BANK)))
    questions = [{"id": q["id"], "topic": q["topic"], "q": q["q"], "options": q["options"]}
                 for q in selected]
    session["mcq_ids"] = [q["id"] for q in selected]
    return jsonify({"questions": questions})


@app.route("/api/mcq/submit", methods=["POST"])
@login_required
def mcq_submit():
    """Check answers, save attempt, return full results."""
    data         = request.json or {}
    user_answers = data.get("answers", {})
    mcq_ids      = session.get("mcq_ids", [])

    if not mcq_ids:
        return jsonify({"ok": False, "error": "No active MCQ session."}), 400

    bank_map = {q["id"]: q for q in MCQ_BANK}
    results  = []
    score    = 0

    for qid in mcq_ids:
        q = bank_map.get(qid)
        if not q:
            continue
        chosen = user_answers.get(str(qid))
        # Issue #25: Explicit type coercion to avoid int/string mismatch
        if chosen is not None:
            try:
                chosen = int(chosen)
            except (ValueError, TypeError):
                chosen = None
        is_correct = (chosen == q["answer"])
        if is_correct:
            score += 1
        results.append({
            "id":         qid,
            "topic":      q["topic"],
            "q":          q["q"],
            "options":    q["options"],
            "chosen":     chosen,
            "correct":    q["answer"],
            "is_correct": is_correct,
            "explain":    q["explain"],
        })

    user_id = session.get("user_id")
    if user_id:
        attempt = MCQAttempt(
            user_id = user_id,
            score   = score,
            answers = json.dumps(results)
        )
        db.session.add(attempt)
        db.session.commit()

    session.pop("mcq_ids", None)
    return jsonify({"ok": True, "score": score, "total": len(results), "results": results})


@app.route("/api/mcq/history")
@login_required
def mcq_history():
    user_id  = session.get("user_id")
    attempts = MCQAttempt.query.filter_by(user_id=user_id)\
                               .order_by(MCQAttempt.timestamp.desc()).all()
    result = [
        {"score": a.score, "timestamp": a.timestamp.strftime("%b %d, %Y %H:%M") if a.timestamp else ""}
        for a in attempts
    ]
    return jsonify(result)


# ─────────────────────────────────────────────
#  Scoring helper
# ─────────────────────────────────────────────

def _compute_score(quiz_key, all_correct, attempt, used_hint):
    scores = session.get("scores", {})
    if quiz_key in scores:
        return scores[quiz_key]
    # Issue #6: Record 0 in backend when max attempts exhausted (attempt >= 2)
    if not all_correct:
        if attempt >= 2:
            scores[quiz_key]  = 0.0
            session["scores"] = scores
            return 0.0
        return None
    if used_hint:
        score = 0.0
    elif attempt == 1:
        score = 5.0
    elif attempt == 2:
        score = 2.5
    else:
        score = 0.0
    scores[quiz_key]  = score
    session["scores"] = scores
    return score


# ─────────────────────────────────────────────
#  Init DB + Entry point
# ─────────────────────────────────────────────

with app.app_context():
    db.create_all()

if __name__ == "__main__":
    app.run(debug=True)
