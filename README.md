# NutriTrack

NutriTrack is a full-stack student portfolio project for tracking daily calories, protein, carbs, and fat. Instead of asking users to manually enter nutrition numbers, the app estimates nutrition from natural food descriptions such as `2 parathas with curd`, `paneer sandwich`, or `oats with milk and banana`.

## Features

- Multi-step onboarding with account creation, personal information, fitness goal, and activity level
- Automatic recommended daily calories and protein based on profile data
- Login, logout, and persistent sessions
- Personalized dashboard with welcome message, current weight, goal weight, recommended calories, recommended protein, streak, goal completion, weekly trends, and category totals
- Meal entry flow: food description -> analyze nutrition -> save meal
- Built-in food search/autocomplete using a small local nutrition database
- Meal history with search, date filter, category filter, edit, and delete
- Analytics page with 7-day calorie chart, 7-day protein chart, category breakdown, and frequent foods
- Profile page for name, age, gender, height, current weight, goal weight, fitness goal, activity level, calorie target, and protein target
- Responsive React + Tailwind UI designed like a polished student internship project

## Tech Stack

Frontend:

- React 18
- Tailwind CSS
- Plain component-based JSX for beginner-friendly code

Backend:

- Python standard library HTTP server
- SQLite database
- PBKDF2 password hashing
- Token-based sessions

The project intentionally avoids heavy external dependencies so it can run easily in a college/demo environment.

## Folder Structure

```text
NutriTrack/
  backend/
    auth.py          # Password hashing and session helpers
    database.py      # SQLite connection, schema, summary recalculation
    nutrition.py     # Local food database and nutrition estimation logic
    server.py        # API routes and frontend static file server
  frontend/
    index.html       # React/Tailwind entry point
    src/
      App.jsx        # All React screens and reusable UI components
      styles.css     # Small global CSS helpers
  README.md
  requirements.txt
```

## Database Schema

`users`

- Stores name, unique email, hashed password, and account creation time.

`sessions`

- Stores hashed session tokens with expiry dates for login persistence.

`user_goals`

- Stores onboarding/profile information: age, gender, current weight, height, goal weight, fitness goal, activity level, daily calorie target, and daily protein target.

`meals`

- Stores each logged meal with food description, normalized estimated food name, category, calories, protein, carbs, fat, confidence score, and logged date.

`daily_summaries`

- Stores recalculated daily totals for calories, protein, carbs, fat, meal count, and goal snapshots.

## Nutrition Estimation Approach

NutriTrack uses a practical local estimator in `backend/nutrition.py`.

1. The user enters a normal food description.
2. The estimator matches known foods and aliases from the built-in nutrition database.
3. It detects simple quantities such as `2 parathas`, `three eggs`, or `half bowl`.
4. It multiplies each matched food by its serving nutrition values.
5. It returns calories, protein, carbs, fat, item-level estimates, and a confidence score.
6. If no known food is matched, it returns a conservative mixed-meal estimate with lower confidence.

This is designed to be understandable for a student project while still feeling intelligent and useful.

## Onboarding and Goal Calculation

Signup is a four-step flow:

1. Account Creation: email and password.
2. Personal Information: full name, age, optional gender, height, and current weight.
3. Fitness Goal: lose weight, maintain weight, or gain weight.
4. Activity Level: sedentary, lightly active, moderately active, or very active.

NutriTrack calculates recommended targets in `backend/server.py`:

- Calories use a Mifflin-St Jeor style BMR estimate.
- The BMR is multiplied by the selected activity level.
- Fitness goal adjusts calories: lose weight subtracts calories, gain weight adds calories, maintain weight keeps the activity estimate.
- Protein is based on current/goal weight and goal type.
- Goal weight is suggested from the selected goal: lower for weight loss, equal for maintenance, and higher for weight gain.

The frontend also calculates a preview during onboarding, but the backend performs the final calculation before saving.

## Authentication Flow

1. User completes the four-step onboarding flow.
2. The backend validates profile fields and calculates recommended calorie/protein targets.
3. The backend hashes the password using PBKDF2 with a random salt.
4. On login, the password is verified against the stored hash.
5. A random session token is created and stored as a SHA-256 hash in SQLite.
6. The frontend stores the plain token in `localStorage`.
7. API requests send the token in the `Authorization: Bearer <token>` header.
8. Logout deletes the session token from the database and clears local storage.

## Running Locally

From the `NutriTrack` folder:

```bash
python3 backend/server.py
```

Open:

```text
http://127.0.0.1:8000
```

The SQLite database is created automatically at:

```text
backend/instance/nutritrack.db
```

## Example Meal Descriptions

- `2 parathas with curd`
- `paneer sandwich`
- `chicken biryani`
- `oats with milk and banana`
- `2 eggs and milk`
- `rice with dal and salad`

## Deployment Steps

Simple VM deployment:

1. Copy the `NutriTrack` folder to a server.
2. Install Python 3.10 or newer.
3. Run `python3 backend/server.py`.
4. Put the app behind Nginx or Caddy for HTTPS.
5. Configure the reverse proxy to forward traffic to `127.0.0.1:8000`.

Suggested production upgrades:

- Move the session secret and database path to environment variables.
- Use Gunicorn/Uvicorn or a small Flask/FastAPI wrapper for larger traffic.
- Replace CDN React/Tailwind with a Vite build pipeline.
- Connect to a larger nutrition API such as USDA FoodData Central for broader food coverage.

## Notes for Resume/Portfolio

NutriTrack demonstrates full-stack CRUD, authentication, multi-step onboarding, profile-driven recommendations, relational schema design, chart-style analytics, local AI-style estimation logic, form validation, responsive UI, and clean beginner-friendly code.
