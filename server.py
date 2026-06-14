from __future__ import annotations

import json
import mimetypes
import re
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from auth import create_session, delete_session, extract_bearer_token, hash_password, user_from_token, verify_password
from database import (
    create_default_goals,
    get_connection,
    get_goals,
    init_db,
    recalculate_daily_summary,
    row_to_dict,
    sync_goal_snapshots,
)
from nutrition import analyze_description, search_foods


ROOT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / "frontend"
CATEGORIES = {"Breakfast", "Lunch", "Dinner", "Snack"}
FITNESS_GOALS = {"Lose Weight", "Maintain Weight", "Gain Weight"}
ACTIVITY_LEVELS = {
    "Sedentary": 1.2,
    "Lightly Active": 1.375,
    "Moderately Active": 1.55,
    "Very Active": 1.725,
}
GENDERS = {"", "Male", "Female", "Other", "Prefer not to say"}


def today_iso() -> str:
    return date.today().isoformat()


def parse_date(value: str | None, fallback: str | None = None) -> str:
    value = value or fallback or today_iso()
    datetime.strptime(value, "%Y-%m-%d")
    return value


def last_seven_days(end_date: str) -> list[str]:
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    return [(end - timedelta(days=offset)).isoformat() for offset in range(6, -1, -1)]


def suggested_goal_weight(weight: float, fitness_goal: str) -> float:
    if fitness_goal == "Lose Weight":
        return round(weight * 0.9, 1)
    if fitness_goal == "Gain Weight":
        return round(weight * 1.1, 1)
    return round(weight, 1)


def calculate_recommendations(profile: dict) -> dict:
    """Estimate daily targets from profile data using a simple student-friendly BMR model."""
    weight = float(profile["weight"])
    height = float(profile["height"])
    age = int(profile["age"])
    gender = profile.get("gender", "")
    fitness_goal = profile["fitness_goal"]
    activity_level = profile["activity_level"]

    gender_adjustment = 5
    if gender == "Female":
        gender_adjustment = -161
    elif gender in ("Other", "Prefer not to say", ""):
        gender_adjustment = -78

    bmr = (10 * weight) + (6.25 * height) - (5 * age) + gender_adjustment
    calories = bmr * ACTIVITY_LEVELS[activity_level]
    if fitness_goal == "Lose Weight":
        calories -= 400
    elif fitness_goal == "Gain Weight":
        calories += 300

    goal_weight = float(profile.get("goal_weight") or suggested_goal_weight(weight, fitness_goal))
    protein_multiplier = {"Lose Weight": 2.0, "Maintain Weight": 1.6, "Gain Weight": 1.7}[fitness_goal]
    protein = max(weight, goal_weight) * protein_multiplier

    return {
        "daily_calorie_target": max(1200, round(calories / 50) * 50),
        "daily_protein_target": max(40, round(protein / 5) * 5),
        "goal_weight": round(goal_weight, 1),
    }


class NutriTrackHandler(BaseHTTPRequestHandler):
    server_version = "NutriTrack/1.0"

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))

    def dispatch(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path.startswith("/api/"):
                self.handle_api(parsed)
            else:
                self.serve_frontend(parsed.path)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
        except PermissionError:
            self.send_json({"error": "Please log in to continue."}, 401)
        except Exception as exc:
            self.send_json({"error": "Server error", "details": str(exc)}, 500)

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

    def send_json(self, payload: dict | list, status: int = 200):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Request body must be valid JSON.") from exc

    def current_user(self, conn) -> dict:
        token = extract_bearer_token(self.headers)
        user = user_from_token(conn, token)
        if not user:
            raise PermissionError()
        return user

    def handle_api(self, parsed):
        path = parsed.path
        method = self.command
        query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}

        with get_connection() as conn:
            if path == "/api/auth/signup" and method == "POST":
                return self.signup(conn)
            if path == "/api/auth/login" and method == "POST":
                return self.login(conn)

            user = self.current_user(conn)

            if path == "/api/auth/logout" and method == "POST":
                delete_session(conn, extract_bearer_token(self.headers))
                return self.send_json({"message": "Logged out."})
            if path == "/api/auth/me" and method == "GET":
                return self.send_json({"user": user, "profile": get_goals(conn, user["id"])})
            if path == "/api/profile" and method == "GET":
                return self.get_profile(conn, user)
            if path == "/api/profile" and method == "PUT":
                return self.update_profile(conn, user)
            if path == "/api/foods/search" and method == "GET":
                return self.send_json({"foods": search_foods(query.get("q", ""))})
            if path == "/api/nutrition/analyze" and method == "POST":
                return self.analyze_food()
            if path == "/api/meals" and method == "GET":
                return self.list_meals(conn, user, query)
            if path == "/api/meals" and method == "POST":
                return self.create_meal(conn, user)
            if path == "/api/dashboard" and method == "GET":
                return self.dashboard(conn, user, query)
            if path == "/api/analytics" and method == "GET":
                return self.analytics(conn, user, query)

            meal_match = re.fullmatch(r"/api/meals/(\d+)", path)
            if meal_match and method == "PUT":
                return self.update_meal(conn, user, int(meal_match.group(1)))
            if meal_match and method == "DELETE":
                return self.delete_meal(conn, user, int(meal_match.group(1)))

        self.send_json({"error": "Route not found."}, 404)

    def signup(self, conn):
        data = self.read_json()
        name = data.get("name", "").strip()
        email = data.get("email", "").lower().strip()
        password = data.get("password", "")
        profile = self.parse_profile_payload(data, require_name=True)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ValueError("Enter a valid email address.")
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters.")
        try:
            cursor = conn.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                (name, email, hash_password(password)),
            )
        except Exception as exc:
            if "UNIQUE" in str(exc):
                raise ValueError("An account with that email already exists.") from exc
            raise
        user_id = cursor.lastrowid
        self.save_profile(conn, user_id, profile)
        token = create_session(conn, user_id)
        user = row_to_dict(conn.execute("SELECT id, name, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone())
        self.send_json({"token": token, "user": user, "profile": get_goals(conn, user_id)}, 201)

    def login(self, conn):
        data = self.read_json()
        email = data.get("email", "").lower().strip()
        password = data.get("password", "")
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            raise ValueError("Invalid email or password.")
        token = create_session(conn, row["id"])
        user = row_to_dict(conn.execute("SELECT id, name, email, created_at FROM users WHERE id = ?", (row["id"],)).fetchone())
        self.send_json({"token": token, "user": user, "profile": get_goals(conn, row["id"])})

    def get_profile(self, conn, user):
        self.send_json({"user": user, "profile": get_goals(conn, user["id"])})

    def update_profile(self, conn, user):
        data = self.read_json()
        fields = self.parse_profile_payload(data, require_name=True, allow_manual_targets=True)
        conn.execute("UPDATE users SET name = ? WHERE id = ?", (fields["name"], user["id"]))
        self.save_profile(conn, user["id"], fields)
        sync_goal_snapshots(conn, user["id"])
        updated_user = row_to_dict(conn.execute("SELECT id, name, email, created_at FROM users WHERE id = ?", (user["id"],)).fetchone())
        self.send_json({"user": updated_user, "profile": get_goals(conn, user["id"])})

    def parse_profile_payload(self, data: dict, require_name: bool = False, allow_manual_targets: bool = False) -> dict:
        name = data.get("name", "").strip()
        if require_name and len(name) < 2:
            raise ValueError("Full name must be at least 2 characters.")
        fields = {
            "name": name,
            "age": int(data.get("age", 0)),
            "gender": data.get("gender", "").strip(),
            "weight": float(data.get("weight", 0)),
            "height": float(data.get("height", 0)),
            "goal_weight": float(data.get("goal_weight") or 0),
            "fitness_goal": data.get("fitness_goal", "").strip(),
            "activity_level": data.get("activity_level", "").strip(),
        }
        if not 10 <= fields["age"] <= 100:
            raise ValueError("Age must be between 10 and 100.")
        if fields["gender"] not in GENDERS:
            raise ValueError("Choose a valid gender option.")
        if not 80 <= fields["height"] <= 250:
            raise ValueError("Height must be between 80 cm and 250 cm.")
        if not 25 <= fields["weight"] <= 250:
            raise ValueError("Weight must be between 25 kg and 250 kg.")
        if fields["fitness_goal"] not in FITNESS_GOALS:
            raise ValueError("Choose a valid fitness goal.")
        if fields["activity_level"] not in ACTIVITY_LEVELS:
            raise ValueError("Choose a valid activity level.")
        if fields["goal_weight"] <= 0:
            fields["goal_weight"] = suggested_goal_weight(fields["weight"], fields["fitness_goal"])
        if not 25 <= fields["goal_weight"] <= 250:
            raise ValueError("Goal weight must be between 25 kg and 250 kg.")

        recommendations = calculate_recommendations(fields)
        fields["goal_weight"] = recommendations["goal_weight"]
        fields["daily_calorie_target"] = recommendations["daily_calorie_target"]
        fields["daily_protein_target"] = recommendations["daily_protein_target"]
        if allow_manual_targets:
            calorie_target = int(data.get("daily_calorie_target") or fields["daily_calorie_target"])
            protein_target = int(data.get("daily_protein_target") or fields["daily_protein_target"])
            if not 1000 <= calorie_target <= 6000:
                raise ValueError("Daily calories must be between 1000 and 6000.")
            if not 30 <= protein_target <= 300:
                raise ValueError("Daily protein must be between 30 g and 300 g.")
            fields["daily_calorie_target"] = calorie_target
            fields["daily_protein_target"] = protein_target
        return fields

    def save_profile(self, conn, user_id: int, fields: dict) -> None:
        conn.execute(
            """
            INSERT INTO user_goals
                (user_id, age, gender, weight, height, goal_weight, fitness_goal, activity_level,
                 daily_calorie_target, daily_protein_target)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                age = excluded.age,
                gender = excluded.gender,
                weight = excluded.weight,
                height = excluded.height,
                goal_weight = excluded.goal_weight,
                fitness_goal = excluded.fitness_goal,
                activity_level = excluded.activity_level,
                daily_calorie_target = excluded.daily_calorie_target,
                daily_protein_target = excluded.daily_protein_target,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                user_id,
                fields["age"],
                fields["gender"],
                fields["weight"],
                fields["height"],
                fields["goal_weight"],
                fields["fitness_goal"],
                fields["activity_level"],
                fields["daily_calorie_target"],
                fields["daily_protein_target"],
            ),
        )

    def analyze_food(self):
        data = self.read_json()
        description = data.get("description", "").strip()
        if len(description) < 2:
            raise ValueError("Describe the food before analyzing it.")
        self.send_json({"analysis": analyze_description(description)})

    def meal_payload(self) -> tuple[dict, dict]:
        data = self.read_json()
        description = data.get("description", "").strip()
        category = data.get("category", "").strip()
        logged_date = parse_date(data.get("logged_date"), today_iso())
        if len(description) < 2:
            raise ValueError("Meal description must be at least 2 characters.")
        if category not in CATEGORIES:
            raise ValueError("Choose a valid meal category.")
        analysis = analyze_description(description)
        return {"description": description, "category": category, "logged_date": logged_date}, analysis

    def create_meal(self, conn, user):
        meal, analysis = self.meal_payload()
        totals = analysis["totals"]
        cursor = conn.execute(
            """
            INSERT INTO meals
                (user_id, description, normalized_name, category, calories, protein, carbs, fat, confidence, logged_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                meal["description"],
                analysis["normalized_name"],
                meal["category"],
                totals["calories"],
                totals["protein"],
                totals["carbs"],
                totals["fat"],
                analysis["confidence"],
                meal["logged_date"],
            ),
        )
        recalculate_daily_summary(conn, user["id"], meal["logged_date"])
        created = row_to_dict(conn.execute("SELECT * FROM meals WHERE id = ?", (cursor.lastrowid,)).fetchone())
        self.send_json({"meal": created, "analysis": analysis}, 201)

    def list_meals(self, conn, user, query):
        meal_date = parse_date(query.get("date"), today_iso())
        category = query.get("category", "All")
        search = query.get("search", "").strip().lower()
        sql = "SELECT * FROM meals WHERE user_id = ? AND logged_date = ?"
        params: list = [user["id"], meal_date]
        if category != "All":
            if category not in CATEGORIES:
                raise ValueError("Invalid category filter.")
            sql += " AND category = ?"
            params.append(category)
        if search:
            sql += " AND (LOWER(description) LIKE ? OR LOWER(normalized_name) LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])
        sql += " ORDER BY created_at DESC"
        meals = [dict(row) for row in conn.execute(sql, params).fetchall()]
        self.send_json({"meals": meals})

    def update_meal(self, conn, user, meal_id: int):
        old = conn.execute("SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, user["id"])).fetchone()
        if not old:
            self.send_json({"error": "Meal not found."}, 404)
            return
        meal, analysis = self.meal_payload()
        totals = analysis["totals"]
        conn.execute(
            """
            UPDATE meals
            SET description = ?, normalized_name = ?, category = ?, calories = ?, protein = ?,
                carbs = ?, fat = ?, confidence = ?, logged_date = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (
                meal["description"],
                analysis["normalized_name"],
                meal["category"],
                totals["calories"],
                totals["protein"],
                totals["carbs"],
                totals["fat"],
                analysis["confidence"],
                meal["logged_date"],
                meal_id,
                user["id"],
            ),
        )
        recalculate_daily_summary(conn, user["id"], old["logged_date"])
        recalculate_daily_summary(conn, user["id"], meal["logged_date"])
        updated = row_to_dict(conn.execute("SELECT * FROM meals WHERE id = ?", (meal_id,)).fetchone())
        self.send_json({"meal": updated, "analysis": analysis})

    def delete_meal(self, conn, user, meal_id: int):
        old = conn.execute("SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, user["id"])).fetchone()
        if not old:
            self.send_json({"error": "Meal not found."}, 404)
            return
        conn.execute("DELETE FROM meals WHERE id = ? AND user_id = ?", (meal_id, user["id"]))
        recalculate_daily_summary(conn, user["id"], old["logged_date"])
        self.send_json({"message": "Meal deleted."})

    def dashboard(self, conn, user, query):
        selected_date = parse_date(query.get("date"), today_iso())
        recalculate_daily_summary(conn, user["id"], selected_date)
        goals = get_goals(conn, user["id"])
        summary = row_to_dict(
            conn.execute(
                "SELECT * FROM daily_summaries WHERE user_id = ? AND summary_date = ?",
                (user["id"], selected_date),
            ).fetchone()
        )
        categories = [
            dict(row)
            for row in conn.execute(
                """
                SELECT category, COALESCE(SUM(calories), 0) AS calories, COUNT(*) AS meal_count
                FROM meals
                WHERE user_id = ? AND logged_date = ?
                GROUP BY category
                """,
                (user["id"], selected_date),
            ).fetchall()
        ]
        days = self.trend_rows(conn, user["id"], selected_date)
        streak = self.calculate_streak(conn, user["id"], selected_date)
        calorie_goal = int(goals["daily_calorie_target"])
        protein_goal = int(goals["daily_protein_target"])
        self.send_json(
            {
                "user": user,
                "summary": summary,
                "goals": goals,
                "remaining_calories": max(0, calorie_goal - int(summary["calories"])),
                "goal_completion": {
                    "calories": min(100, round(int(summary["calories"]) / calorie_goal * 100)),
                    "protein": min(100, round(float(summary["protein"]) / protein_goal * 100)),
                },
                "category_breakdown": categories,
                "weekly_trend": days,
                "streak": streak,
            }
        )

    def analytics(self, conn, user, query):
        end_date = parse_date(query.get("end_date"), today_iso())
        days = self.trend_rows(conn, user["id"], end_date)
        start_date = days[0]["date"]
        categories = [
            dict(row)
            for row in conn.execute(
                """
                SELECT category, COALESCE(SUM(calories), 0) AS calories, COALESCE(SUM(protein), 0) AS protein, COUNT(*) AS meal_count
                FROM meals
                WHERE user_id = ? AND logged_date BETWEEN ? AND ?
                GROUP BY category
                ORDER BY calories DESC
                """,
                (user["id"], start_date, end_date),
            ).fetchall()
        ]
        frequent = [
            dict(row)
            for row in conn.execute(
                """
                SELECT normalized_name AS food, COUNT(*) AS times_logged, ROUND(AVG(calories), 0) AS avg_calories
                FROM meals
                WHERE user_id = ? AND logged_date BETWEEN ? AND ?
                GROUP BY normalized_name
                ORDER BY times_logged DESC, avg_calories DESC
                LIMIT 6
                """,
                (user["id"], start_date, end_date),
            ).fetchall()
        ]
        self.send_json({"weekly_trend": days, "category_breakdown": categories, "frequent_foods": frequent})

    def trend_rows(self, conn, user_id: int, end_date: str) -> list[dict]:
        rows = {
            row["summary_date"]: dict(row)
            for row in conn.execute(
                """
                SELECT summary_date, calories, protein, carbs, fat, meal_count
                FROM daily_summaries
                WHERE user_id = ? AND summary_date BETWEEN ? AND ?
                """,
                (user_id, last_seven_days(end_date)[0], end_date),
            ).fetchall()
        }
        trend = []
        for day in last_seven_days(end_date):
            row = rows.get(day, {})
            trend.append(
                {
                    "date": day,
                    "calories": int(row.get("calories", 0)),
                    "protein": float(row.get("protein", 0)),
                    "carbs": float(row.get("carbs", 0)),
                    "fat": float(row.get("fat", 0)),
                    "meal_count": int(row.get("meal_count", 0)),
                }
            )
        return trend

    def calculate_streak(self, conn, user_id: int, end_date: str) -> int:
        day = datetime.strptime(end_date, "%Y-%m-%d").date()
        streak = 0
        while True:
            row = conn.execute(
                "SELECT meal_count FROM daily_summaries WHERE user_id = ? AND summary_date = ?",
                (user_id, day.isoformat()),
            ).fetchone()
            if not row or row["meal_count"] == 0:
                break
            streak += 1
            day -= timedelta(days=1)
        return streak

    def serve_frontend(self, path: str):
        if path in ("", "/"):
            file_path = FRONTEND_DIR / "index.html"
        else:
            requested = (FRONTEND_DIR / path.lstrip("/")).resolve()
            if FRONTEND_DIR.resolve() not in requested.parents and requested != FRONTEND_DIR.resolve():
                self.send_json({"error": "Invalid file path."}, 400)
                return
            file_path = requested if requested.exists() else FRONTEND_DIR / "index.html"

        if not file_path.exists():
            self.send_json({"error": "Frontend file not found."}, 404)
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "text/html"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run(host: str = "127.0.0.1", port: int = 8000):
    init_db()
    server = ThreadingHTTPServer((host, port), NutriTrackHandler)
    print(f"NutriTrack is running at http://{host}:{port}")
    print("Press Ctrl+C to stop the server.")
    server.serve_forever()


if __name__ == "__main__":
    run()
