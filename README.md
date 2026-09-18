# [LES] — Linear Equation System Solver

An interactive web app that doesn't just solve systems of linear equations — it **teaches** you how, and scores you on every step of getting there.

Instead of the usual "enter equations → get answer" flow, LES walks you through Gaussian elimination one concept at a time: build the augmented matrix, compute the rank, classify the solution type, and derive the final answer — with hints, retries, and attempt-based scoring at each stage. Your progress is tracked over time on a personal dashboard, and you can compare yourself against others on a leaderboard.

---

## ✨ Features

- **Custom equation input** — enter any system of linear equations (up to 5×5), not just preset examples
- **Step-by-step guided solver** covering:
  - Augmented matrix construction
  - Rank computation (coefficient matrix vs. augmented matrix)
  - Solution type classification (unique / infinite / no solution)
  - Final answer derivation
- **Attempt-based scoring** — full marks for a correct first try, reduced marks for a second attempt, zero if a hint is used or attempts run out
- **Hints & retries** on every step, with clear feedback (correct/incorrect, marks earned)
- **Full Gaussian elimination breakdown** — every row operation shown, with fractional/whole-number formatting
- **MCQ theory mode** — a separate bank of conceptual questions (rank, row echelon form, free variables, homogeneous systems, consistency) served in randomized sets of 5
- **User accounts** — signup/login with hashed passwords, session-based auth
- **Analytics dashboard** — score trends, per-step skill breakdown, hint usage vs. score, a skill radar chart, and personalized "what to practice next" suggestions
- **Progress tracking** — full attempt history with aggregate stats (best/avg score, improvement over time, weakest/strongest step, hint-free streaks)
- **Leaderboard** — ranks users by a weighted score (`avg × 0.7 + best × 0.3`) among users with a minimum number of attempts

---

## 🛠️ Tech Stack

| Layer          | Technology                          |
|----------------|--------------------------------------|
| Backend        | Flask (Python)                       |
| Database / ORM | Flask-SQLAlchemy — SQLite by default, Postgres-compatible (e.g. Supabase) via `DATABASE_URL` |
| Auth           | Flask sessions, Werkzeug password hashing |
| Math engine    | NumPy (rank computation), custom Gaussian elimination implementation |
| Frontend       | Vanilla JavaScript, HTML, CSS        |
| Charts         | Chart.js                             |

---

## 📁 Project Structure

```
les_new/
├── app.py                  # Flask app: routes, models, math engine, MCQ bank
├── templates/
│   ├── home.html            # Landing page + auth modal
│   ├── index.html           # Step-by-step quiz flow (matrix config → results)
│   ├── dashboard.html        # Analytics dashboard (score trends, skill breakdown)
│   ├── progress.html         # Detailed attempt history & stats
│   └── mcq.html              # MCQ theory quiz
├── static/
│   ├── css/style.css
│   └── js/
│       ├── app.js            # Quiz flow logic
│       └── dashboard.js      # Dashboard rendering logic
└── instance/
    └── les_users.db          # SQLite database (created on first run)
```

---

## 🚀 Getting Started

### Prerequisites
- Python 3.9+

### Installation

```bash
# Clone the repo
git clone https://github.com/Swaroop7979/LES_Project.git
cd les_new

# Install dependencies
pip install flask flask-sqlalchemy numpy python-dotenv
```

### Environment Setup

Create a `.env` file in the project root (optional, but recommended):

```
LES_SECRET_KEY=your-secret-key-here
DATABASE_URL=sqlite:///les_users.db
```

If `LES_SECRET_KEY` isn't set, the app falls back to a development default and prints a warning — fine for local testing, **not for production**.

By default, the app uses a local SQLite database (`les_users.db`) — no extra setup needed. `DATABASE_URL` can instead point to any Postgres-compatible connection string (e.g. a Supabase project) for a hosted deployment; just set it in `.env` or your platform's environment variables.

> **Note:** the original deployment for this project used a free-tier Supabase Postgres instance, which has since expired/paused. The live hosted link is no longer active as a result — running locally with the default SQLite database works out of the box, or you can connect a fresh Postgres/Supabase instance by setting `DATABASE_URL`.

### Run

```bash
python app.py
```

The app will be available at `http://localhost:5000`. The database tables are created automatically on first run.

---

## 🧮 How It Works

1. **Sign up / log in** to start tracking your attempts.
2. **Set matrix dimensions** (equations × variables, up to 5×5) and enter your system's coefficients.
3. Work through four scored steps:
   - Form the augmented matrix `[A | b]`
   - Compute `rank(A)` and `rank([A|b])`
   - Classify the solution type based on the rank comparison
   - Derive the final numeric solution
4. Review the **full Gaussian elimination steps** and final answer on the results page.
5. Check your **dashboard** and **progress** page to see trends, strengths, and weak spots over time.
6. Test conceptual understanding separately in **MCQ mode**.

---

## 📌 Notes

- Matrix size is capped at 5×5 with whole-number coefficients.
- Scoring per step: **5 marks** for a correct first attempt, **2.5** for a correct second attempt, **0** if a hint was used or both attempts are exhausted.
- The leaderboard only ranks users with a minimum of 3 attempts, to keep rankings meaningful.

---

## 👥 Team

Built by Swaroop Maluskar , Dhiren Kolaskar , Sharval Pardeshi and Ram Khabale as first-year project at PCCOE.


