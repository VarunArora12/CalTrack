from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "instance" / "nutritrack.db"


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS user_goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                age INTEGER NOT NULL DEFAULT 20,
                gender TEXT NOT NULL DEFAULT '',
                weight REAL NOT NULL DEFAULT 70,
                height REAL NOT NULL DEFAULT 170,
                goal_weight REAL NOT NULL DEFAULT 65,
                fitness_goal TEXT NOT NULL DEFAULT 'Maintain Weight',
                activity_level TEXT NOT NULL DEFAULT 'Lightly Active',
                daily_calorie_target INTEGER NOT NULL DEFAULT 2200,
                daily_protein_target INTEGER NOT NULL DEFAULT 120,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS meals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                normalized_name TEXT NOT NULL,
                category TEXT NOT NULL CHECK (category IN ('Breakfast', 'Lunch', 'Dinner', 'Snack')),
                calories INTEGER NOT NULL,
                protein REAL NOT NULL,
                carbs REAL NOT NULL,
                fat REAL NOT NULL,
                confidence INTEGER NOT NULL,
                logged_date TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS daily_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                summary_date TEXT NOT NULL,
                calories INTEGER NOT NULL DEFAULT 0,
                protein REAL NOT NULL DEFAULT 0,
                carbs REAL NOT NULL DEFAULT 0,
                fat REAL NOT NULL DEFAULT 0,
                meal_count INTEGER NOT NULL DEFAULT 0,
                calorie_goal INTEGER NOT NULL DEFAULT 2200,
                protein_goal INTEGER NOT NULL DEFAULT 120,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, summary_date),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meals(user_id, logged_date);
            CREATE INDEX IF NOT EXISTS idx_meals_user_category ON meals(user_id, category);
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
            """
        )
        ensure_profile_columns(conn)


def ensure_profile_columns(conn: sqlite3.Connection) -> None:
    """Add onboarding columns when an older local SQLite database already exists."""
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(user_goals)").fetchall()}
    migrations = {
        "age": "ALTER TABLE user_goals ADD COLUMN age INTEGER NOT NULL DEFAULT 20",
        "gender": "ALTER TABLE user_goals ADD COLUMN gender TEXT NOT NULL DEFAULT ''",
        "fitness_goal": "ALTER TABLE user_goals ADD COLUMN fitness_goal TEXT NOT NULL DEFAULT 'Maintain Weight'",
        "activity_level": "ALTER TABLE user_goals ADD COLUMN activity_level TEXT NOT NULL DEFAULT 'Lightly Active'",
    }
    for column, statement in migrations.items():
        if column not in columns:
            conn.execute(statement)


def create_default_goals(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO user_goals
            (user_id, age, gender, weight, height, goal_weight, fitness_goal, activity_level,
             daily_calorie_target, daily_protein_target)
        VALUES (?, 20, '', 70, 170, 70, 'Maintain Weight', 'Lightly Active', 2200, 120)
        """,
        (user_id,),
    )


def get_goals(conn: sqlite3.Connection, user_id: int) -> dict:
    create_default_goals(conn, user_id)
    row = conn.execute("SELECT * FROM user_goals WHERE user_id = ?", (user_id,)).fetchone()
    return dict(row)


def recalculate_daily_summary(conn: sqlite3.Connection, user_id: int, summary_date: str | None = None) -> None:
    """Keep the summary table in sync whenever meals or goals change."""
    summary_date = summary_date or date.today().isoformat()
    totals = conn.execute(
        """
        SELECT
            COALESCE(SUM(calories), 0) AS calories,
            COALESCE(SUM(protein), 0) AS protein,
            COALESCE(SUM(carbs), 0) AS carbs,
            COALESCE(SUM(fat), 0) AS fat,
            COUNT(*) AS meal_count
        FROM meals
        WHERE user_id = ? AND logged_date = ?
        """,
        (user_id, summary_date),
    ).fetchone()
    goals = get_goals(conn, user_id)
    conn.execute(
        """
        INSERT INTO daily_summaries
            (user_id, summary_date, calories, protein, carbs, fat, meal_count, calorie_goal, protein_goal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, summary_date) DO UPDATE SET
            calories = excluded.calories,
            protein = excluded.protein,
            carbs = excluded.carbs,
            fat = excluded.fat,
            meal_count = excluded.meal_count,
            calorie_goal = excluded.calorie_goal,
            protein_goal = excluded.protein_goal,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            user_id,
            summary_date,
            int(totals["calories"]),
            round(float(totals["protein"]), 1),
            round(float(totals["carbs"]), 1),
            round(float(totals["fat"]), 1),
            int(totals["meal_count"]),
            int(goals["daily_calorie_target"]),
            int(goals["daily_protein_target"]),
        ),
    )


def sync_goal_snapshots(conn: sqlite3.Connection, user_id: int) -> None:
    goals = get_goals(conn, user_id)
    conn.execute(
        """
        UPDATE daily_summaries
        SET calorie_goal = ?, protein_goal = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
        """,
        (goals["daily_calorie_target"], goals["daily_protein_target"], user_id),
    )
