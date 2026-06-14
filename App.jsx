const { useEffect, useMemo, useState } = React;

const API_BASE = "/api";
const TOKEN_KEY = "caltrack_session_token";
const categories = ["Breakfast", "Lunch", "Dinner", "Snack"];
const fitnessGoals = ["Lose Weight", "Maintain Weight", "Gain Weight"];
const activityLevels = ["Sedentary", "Lightly Active", "Moderately Active", "Very Active"];
const genders = ["", "Male", "Female", "Other", "Prefer not to say"];
const activityMultipliers = {
  "Sedentary": 1.2,
  "Lightly Active": 1.375,
  "Moderately Active": 1.55,
  "Very Active": 1.725,
};
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function suggestedGoalWeight(weight, fitnessGoal) {
  const current = Number(weight) || 0;
  if (fitnessGoal === "Lose Weight") return Math.round(current * 0.9 * 10) / 10;
  if (fitnessGoal === "Gain Weight") return Math.round(current * 1.1 * 10) / 10;
  return Math.round(current * 10) / 10;
}

function calculateRecommendations(profile) {
  const weight = Number(profile.weight) || 0;
  const height = Number(profile.height) || 0;
  const age = Number(profile.age) || 0;
  const goalWeight = Number(profile.goal_weight) || suggestedGoalWeight(weight, profile.fitness_goal);
  let genderAdjustment = 5;
  if (profile.gender === "Female") genderAdjustment = -161;
  if (!profile.gender || profile.gender === "Other" || profile.gender === "Prefer not to say") genderAdjustment = -78;

  const bmr = 10 * weight + 6.25 * height - 5 * age + genderAdjustment;
  let calories = bmr * (activityMultipliers[profile.activity_level] || 1.375);
  if (profile.fitness_goal === "Lose Weight") calories -= 400;
  if (profile.fitness_goal === "Gain Weight") calories += 300;

  const proteinMultiplier = profile.fitness_goal === "Lose Weight" ? 2 : profile.fitness_goal === "Gain Weight" ? 1.7 : 1.6;
  return {
    goal_weight: Math.max(0, Math.round(goalWeight * 10) / 10),
    daily_calorie_target: Math.max(1200, Math.round(calories / 50) * 50 || 0),
    daily_protein_target: Math.max(40, Math.round((Math.max(weight, goalWeight) * proteinMultiplier) / 5) * 5 || 0),
  };
}

async function apiRequest(path, options = {}) {
  const token = options.token ?? localStorage.getItem(TOKEN_KEY);
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY));
  const [session, setSession] = useState(null);
  const [page, setPage] = useState("Dashboard");
  const [loading, setLoading] = useState(Boolean(token));
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    apiRequest("/auth/me", { token })
      .then(setSession)
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  function saveSession(data) {
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setSession({ user: data.user, profile: data.profile });
  }

  function handleProfileSaved(data) {
    setSession((current) => ({ ...current, user: data.user, profile: data.profile }));
    setRefreshKey((key) => key + 1);
  }

  async function logout() {
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setSession(null);
    setPage("Dashboard");
  }

  if (loading) return <LoadingScreen />;
  if (!token || !session) return <AuthScreen onAuth={saveSession} />;

  return (
    <Shell user={session.user} page={page} setPage={setPage} onLogout={logout}>
      {page === "Dashboard" && <Dashboard refreshKey={refreshKey} setPage={setPage} />}
      {page === "Add Meal" && <AddMeal onSaved={() => setRefreshKey((key) => key + 1)} />}
      {page === "Meal History" && <MealHistory refreshKey={refreshKey} onChanged={() => setRefreshKey((key) => key + 1)} />}
      {page === "Analytics" && <Analytics refreshKey={refreshKey} />}
      {page === "Profile" && <Profile onProfileSaved={handleProfileSaved} />}
    </Shell>
  );
}

function LoadingScreen() {
  return (
    <main className="min-h-screen grid place-items-center">
      <div className="rounded-lg bg-white px-6 py-5 soft-shadow">Loading CalTrack...</div>
    </main>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    age: "",
    gender: "",
    height: "",
    weight: "",
    goal_weight: "",
    fitness_goal: "Maintain Weight",
    activity_level: "Lightly Active",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recommendations = useMemo(() => calculateRecommendations(form), [form]);

  function updateForm(field, value) {
    const next = { ...form, [field]: value };
    if (field === "weight" || field === "fitness_goal") {
      next.goal_weight = suggestedGoalWeight(next.weight, next.fitness_goal);
    }
    setForm(next);
  }

  function validateStep() {
    if (step === 1) {
      if (!form.email.includes("@")) return "Enter a valid email address.";
      if (form.password.length < 6) return "Password must be at least 6 characters.";
    }
    if (step === 2) {
      if (form.name.trim().length < 2) return "Enter your full name.";
      if (Number(form.age) < 10 || Number(form.age) > 100) return "Age must be between 10 and 100.";
      if (Number(form.height) < 80 || Number(form.height) > 250) return "Height must be between 80 cm and 250 cm.";
      if (Number(form.weight) < 25 || Number(form.weight) > 250) return "Weight must be between 25 kg and 250 kg.";
    }
    return "";
  }

  function nextStep() {
    const message = validateStep();
    if (message) return setError(message);
    setError("");
    setStep((current) => current + 1);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (mode === "signup" && step < 4) return nextStep();
    setBusy(true);
    try {
      const data = await apiRequest(`/auth/${mode === "login" ? "login" : "signup"}`, {
        method: "POST",
        body: {
          ...form,
          goal_weight: form.goal_weight || recommendations.goal_weight,
          daily_calorie_target: recommendations.daily_calorie_target,
          daily_protein_target: recommendations.daily_protein_target,
        },
        token: "",
      });
      onAuth(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-mint via-slate-50 to-skySoft px-4 py-10">
      <section className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[1.05fr_.95fr] md:items-center">
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-leaf"></p>
          <h1 className="text-4xl font-bold tracking-tight text-ink md:text-5xl">CalTrack</h1>
          <p className="mt-4 max-w-xl text-lg text-slate-600">
            An intelligent nutrition tracker that estimates calories, protein, carbs, and fat from everyday food descriptions.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <MiniFeature title="Food AI" text="Type meals like paneer sandwich or 2 parathas with curd." />
            <MiniFeature title="Charts" text="Track weekly calories, protein, and meal categories." />
            <MiniFeature title="SQLite" text="Includes auth, sessions, goals, meals, and summaries." />
          </div>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-6 soft-shadow">
          <div className="mb-5 flex rounded-lg bg-slate-100 p-1">
            {["login", "signup"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setMode(item);
                  setError("");
                  setStep(1);
                }}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold ${mode === item ? "bg-white text-leaf shadow-sm" : "text-slate-500"}`}
              >
                {item === "login" ? "Login" : "Signup"}
              </button>
            ))}
          </div>

          {mode === "signup" && <OnboardingProgress step={step} />}

          {mode === "login" && (
            <>
              <Field label="Email">
                <input className="input" type="email" value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="Email" />
              </Field>
              <Field label="Password">
                <input className="input" type="password" value={form.password} onChange={(e) => updateForm("password", e.target.value)} placeholder="At least 6 characters" />
              </Field>
            </>
          )}

          {mode === "signup" && step === 1 && (
            <>
              <h2 className="mb-3 text-xl font-bold">Step 1: Account Creation</h2>
              <Field label="Email">
                <input className="input" type="email" value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="Email" />
              </Field>
              <Field label="Password">
                <input className="input" type="password" value={form.password} onChange={(e) => updateForm("password", e.target.value)} placeholder="At least 6 characters" />
              </Field>
            </>
          )}

          {mode === "signup" && step === 2 && (
            <>
              <h2 className="mb-3 text-xl font-bold">Step 2: Personal Information</h2>
              <Field label="Full Name">
                <input className="input" value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder="Varun Sharma" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField label="Age" value={form.age} onChange={(value) => updateForm("age", value)} />
                <Field label="Gender (optional)">
                  <select className="input" value={form.gender} onChange={(e) => updateForm("gender", e.target.value)}>
                    {genders.map((item) => <option key={item} value={item}>{item || "Select gender"}</option>)}
                  </select>
                </Field>
                <NumberField label="Height (cm)" value={form.height} onChange={(value) => updateForm("height", value)} />
                <NumberField label="Current Weight (kg)" value={form.weight} onChange={(value) => updateForm("weight", value)} />
              </div>
            </>
          )}

          {mode === "signup" && step === 3 && (
            <>
              <h2 className="mb-3 text-xl font-bold">Step 3: Fitness Goal</h2>
              <ChoiceGrid options={fitnessGoals} value={form.fitness_goal} onChange={(value) => updateForm("fitness_goal", value)} />
              <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                Suggested goal weight: <strong>{recommendations.goal_weight || 0} kg</strong>
              </div>
            </>
          )}

          {mode === "signup" && step === 4 && (
            <>
              <h2 className="mb-3 text-xl font-bold">Step 4: Activity Level</h2>
              <ChoiceGrid options={activityLevels} value={form.activity_level} onChange={(value) => updateForm("activity_level", value)} />
              <RecommendationPreview profile={{ ...form, ...recommendations }} />
            </>
          )}

          {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            {mode === "signup" && step > 1 && (
              <button type="button" onClick={() => setStep((current) => current - 1)} className="rounded-md border border-slate-200 px-4 py-3 font-semibold text-slate-600">
                Back
              </button>
            )}
            <button disabled={busy} className="flex-1 rounded-md bg-leaf px-4 py-3 font-semibold text-white hover:bg-green-700 disabled:opacity-60">
              {busy ? "Please wait..." : mode === "login" ? "Login to Dashboard" : step < 4 ? "Continue" : "Create Account"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function OnboardingProgress({ step }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex justify-between text-xs font-semibold text-slate-500">
        <span>Onboarding</span>
        <span>Step {step} of 4</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-leaf" style={{ width: `${step * 25}%` }} />
      </div>
    </div>
  );
}

function ChoiceGrid({ options, value, onChange }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-lg border px-4 py-3 text-left font-semibold ${value === option ? "border-leaf bg-mint text-green-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function RecommendationPreview({ profile }) {
  return (
    <div className="mt-4 rounded-lg border border-green-100 bg-mint p-4">
      <h3 className="font-bold text-green-800">Recommended targets</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Macro label="Daily Calories" value={profile.daily_calorie_target} suffix="kcal" />
        <Macro label="Daily Protein" value={profile.daily_protein_target} suffix="g" />
        <Macro label="Current Weight" value={profile.weight || 0} suffix="kg" />
        <Macro label="Goal Weight" value={profile.goal_weight || 0} suffix="kg" />
      </div>
    </div>
  );
}

function MiniFeature({ title, text }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/75 p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{text}</p>
    </div>
  );
}

function Shell({ user, page, setPage, onLogout, children }) {
  const links = ["Dashboard", "Add Meal", "Meal History", "Analytics", "Profile"];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink">CalTrack</h1>
            <p className="text-sm text-slate-500">Welcome, {user.name}</p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {links.map((link) => (
              <button
                key={link}
                onClick={() => setPage(link)}
                className={`rounded-md px-3 py-2 text-sm font-medium ${page === link ? "bg-leaf text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              >
                {link}
              </button>
            ))}
            <button onClick={onLogout} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Logout
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

function Dashboard({ refreshKey, setPage }) {
  const [date, setDate] = useState(today());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest(`/dashboard?date=${date}`).then(setData).catch((err) => setError(err.message));
  }, [date, refreshKey]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <LoadingCard />;

  const { summary, goals, weekly_trend, category_breakdown, goal_completion, user } = data;
  return (
    <section className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Today at a glance, with goal progress and weekly trends.">
        <input type="date" className="input max-w-44" value={date} onChange={(e) => setDate(e.target.value)} />
      </PageHeader>

      <section className="rounded-lg border border-green-100 bg-mint p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700">Personalized dashboard</p>
        <h3 className="mt-1 text-2xl font-bold">Welcome back, {user.name}</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ProfileMetric label="Current Weight" value={goals.weight} suffix="kg" />
          <ProfileMetric label="Goal Weight" value={goals.goal_weight} suffix="kg" />
          <ProfileMetric label="Daily Calories" value={goals.daily_calorie_target} suffix="kcal" />
          <ProfileMetric label="Daily Protein" value={goals.daily_protein_target} suffix="g" />
        </div>
        <p className="mt-3 text-sm text-green-700">
          Goal: {goals.fitness_goal} · Activity: {goals.activity_level}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Calories consumed" value={summary.calories} suffix="kcal" detail={`${goal_completion.calories}% of daily goal`} />
        <StatCard label="Protein consumed" value={summary.protein} suffix="g" detail={`${goal_completion.protein}% of daily goal`} />
        <StatCard label="Remaining calories" value={data.remaining_calories} suffix="kcal" detail={`Goal: ${goals.daily_calorie_target} kcal`} />
        <StatCard label="Logging streak" value={data.streak} suffix="days" detail={`${summary.meal_count} meals on selected date`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_.9fr]">
        <Panel title="Weekly calorie trend">
          <BarChart data={weekly_trend} valueKey="calories" color="bg-leaf" suffix="kcal" />
        </Panel>
        <Panel title="Goal completion">
          <ProgressRow label="Calories" value={goal_completion.calories} />
          <ProgressRow label="Protein" value={goal_completion.protein} />
          <button onClick={() => setPage("Add Meal")} className="mt-5 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            Add a meal
          </button>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
        <Panel title="Calories by category">
          <CategoryBars categories={category_breakdown} />
        </Panel>
        <Panel title="Weekly protein trend">
          <BarChart data={weekly_trend} valueKey="protein" color="bg-sky-500" suffix="g" />
        </Panel>
      </div>
    </section>
  );
}

function AddMeal({ onSaved }) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Breakfast");
  const [loggedDate, setLoggedDate] = useState(today());
  const [analysis, setAnalysis] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (description.trim().length < 2) return setSuggestions([]);
      apiRequest(`/foods/search?q=${encodeURIComponent(description)}`)
        .then((data) => setSuggestions(data.foods))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [description]);

  async function analyze() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const data = await apiRequest("/nutrition/analyze", { method: "POST", body: { description } });
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveMeal(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await apiRequest("/meals", { method: "POST", body: { description, category, logged_date: loggedDate } });
      setMessage("Meal saved successfully.");
      setDescription("");
      setAnalysis(null);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Add Meal" subtitle="Describe the food, review the estimate, then save it." />
      <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <Panel title="Food description">
          <form onSubmit={saveMeal} className="space-y-4">
            <Field label="What did you eat?">
              <textarea
                className="input min-h-28"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setAnalysis(null);
                }}
                placeholder="Example: 2 parathas with curd, paneer sandwich, oats with milk and banana"
              />
            </Field>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((food) => (
                  <button key={food.name} type="button" onClick={() => setDescription(food.name)} className="rounded-full bg-mint px-3 py-1 text-sm font-medium text-green-700">
                    {food.name}
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Meal category">
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" className="input" value={loggedDate} onChange={(e) => setLoggedDate(e.target.value)} />
              </Field>
            </div>
            {error && <ErrorBox message={error} />}
            {message && <SuccessBox message={message} />}
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={analyze} disabled={busy} className="rounded-md bg-ink px-4 py-2 font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
                {busy ? "Analyzing..." : "Analyze Food"}
              </button>
              <button type="submit" disabled={!analysis || busy} className="rounded-md bg-leaf px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                Save Meal
              </button>
            </div>
          </form>
        </Panel>
        <NutritionPreview analysis={analysis} />
      </div>
    </section>
  );
}

function NutritionPreview({ analysis }) {
  if (!analysis) {
    return (
      <Panel title="Nutrition estimate">
        <EmptyState title="No estimate yet" text="Enter a food description and click Analyze Food." />
      </Panel>
    );
  }
  const totals = analysis.totals;
  return (
    <Panel title="Nutrition estimate">
      <div className="grid grid-cols-2 gap-3">
        <Macro label="Calories" value={totals.calories} suffix="kcal" />
        <Macro label="Protein" value={totals.protein} suffix="g" />
        <Macro label="Carbs" value={totals.carbs} suffix="g" />
        <Macro label="Fat" value={totals.fat} suffix="g" />
      </div>
      <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Confidence: {analysis.confidence}% · {analysis.note}</p>
      <div className="mt-4 space-y-2">
        {analysis.items.map((item, index) => (
          <div key={`${item.food}-${index}`} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
            <span>{item.quantity} x {item.food}</span>
            <span className="font-semibold">{item.calories} kcal</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MealHistory({ refreshKey, onChanged }) {
  const [filters, setFilters] = useState({ date: today(), category: "All", search: "" });
  const [meals, setMeals] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(filters).toString();
    apiRequest(`/meals?${query}`)
      .then((data) => setMeals(data.meals))
      .catch((err) => setError(err.message));
  }, [filters, refreshKey]);

  async function deleteMeal(id) {
    if (!confirm("Delete this meal?")) return;
    await apiRequest(`/meals/${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Meal History" subtitle="Search, filter, edit, and delete logged meals." />
      <Panel title="Filters">
        <div className="grid gap-3 md:grid-cols-3">
          <input type="date" className="input" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
          <select className="input" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
            <option>All</option>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
          <input className="input" placeholder="Search meals..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </div>
      </Panel>
      {error && <ErrorBox message={error} />}
      <Panel title={`Meals (${meals.length})`}>
        {meals.length === 0 ? (
          <EmptyState title="No meals found" text="Try another date, category, or search term." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3">Meal</th>
                  <th>Category</th>
                  <th>Calories</th>
                  <th>Protein</th>
                  <th>Carbs</th>
                  <th>Fat</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {meals.map((meal) => (
                  <tr key={meal.id} className="border-b border-slate-100">
                    <td className="py-3">
                      <p className="font-semibold">{meal.description}</p>
                      <p className="text-xs text-slate-500">{meal.normalized_name} · {meal.confidence}% confidence</p>
                    </td>
                    <td><Badge>{meal.category}</Badge></td>
                    <td>{meal.calories}</td>
                    <td>{meal.protein}g</td>
                    <td>{meal.carbs}g</td>
                    <td>{meal.fat}g</td>
                    <td className="space-x-2 text-right">
                      <button onClick={() => setEditing(meal)} className="rounded-md bg-slate-100 px-3 py-1 font-medium hover:bg-slate-200">Edit</button>
                      <button onClick={() => deleteMeal(meal.id)} className="rounded-md bg-red-50 px-3 py-1 font-medium text-red-700 hover:bg-red-100">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <EditMealModal meal={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </section>
  );
}

function EditMealModal({ meal, onClose, onSaved }) {
  const [form, setForm] = useState({ description: meal.description, category: meal.category, logged_date: meal.logged_date });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest(`/meals/${meal.id}`, { method: "PUT", body: form });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-slate-900/35 px-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-lg bg-white p-5 soft-shadow">
        <h3 className="text-lg font-bold">Edit meal</h3>
        <p className="mt-1 text-sm text-slate-500">Changing the description automatically recalculates nutrition.</p>
        <div className="mt-4 space-y-4">
          <Field label="Food description">
            <textarea className="input min-h-24" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" className="input" value={form.logged_date} onChange={(e) => setForm({ ...form, logged_date: e.target.value })} />
            </Field>
          </div>
          {error && <ErrorBox message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-4 py-2 font-semibold">Cancel</button>
            <button className="rounded-md bg-leaf px-4 py-2 font-semibold text-white">Save changes</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Analytics({ refreshKey }) {
  const [endDate, setEndDate] = useState(today());
  const [data, setData] = useState(null);

  useEffect(() => {
    apiRequest(`/analytics?end_date=${endDate}`).then(setData);
  }, [endDate, refreshKey]);

  if (!data) return <LoadingCard />;

  return (
    <section className="space-y-6">
      <PageHeader title="Analytics" subtitle="Simple visuals that make weekly patterns easy to understand.">
        <input type="date" className="input max-w-44" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Last 7 days calories">
          <BarChart data={data.weekly_trend} valueKey="calories" color="bg-leaf" suffix="kcal" />
        </Panel>
        <Panel title="Last 7 days protein">
          <BarChart data={data.weekly_trend} valueKey="protein" color="bg-sky-500" suffix="g" />
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
        <Panel title="Category breakdown">
          <CategoryBars categories={data.category_breakdown} />
        </Panel>
        <Panel title="Most frequently logged foods">
          {data.frequent_foods.length === 0 ? (
            <EmptyState title="No frequent foods yet" text="Log a few meals to see patterns." />
          ) : (
            <div className="space-y-3">
              {data.frequent_foods.map((food) => (
                <div key={food.food} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                  <div>
                    <p className="font-semibold">{food.food}</p>
                    <p className="text-sm text-slate-500">{food.times_logged} logs</p>
                  </div>
                  <span className="text-sm font-semibold">{food.avg_calories} kcal avg</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </section>
  );
}

function Profile({ onProfileSaved }) {
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest("/profile").then((data) => setForm({ ...data.profile, name: data.user.name }));
  }, []);

  const recommendations = useMemo(() => (form ? calculateRecommendations(form) : null), [form]);

  function updateProfileField(field, value) {
    const next = { ...form, [field]: value };
    if (field === "weight" || field === "fitness_goal") {
      next.goal_weight = suggestedGoalWeight(next.weight, next.fitness_goal);
    }
    const recalculated = calculateRecommendations(next);
    if (!["daily_calorie_target", "daily_protein_target"].includes(field)) {
      next.daily_calorie_target = recalculated.daily_calorie_target;
      next.daily_protein_target = recalculated.daily_protein_target;
      next.goal_weight = recalculated.goal_weight;
    }
    setForm(next);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const data = await apiRequest("/profile", { method: "PUT", body: form });
      setForm({ ...data.profile, name: data.user.name });
      setMessage("Profile updated.");
      onProfileSaved(data);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!form) return <LoadingCard />;

  return (
    <section className="space-y-6">
      <PageHeader title="User Profile" subtitle="Edit onboarding details and nutrition targets used throughout CalTrack." />
      <Panel title="Goals and body details">
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          <Field label="Full Name">
            <input className="input" value={form.name} onChange={(e) => updateProfileField("name", e.target.value)} />
          </Field>
          <NumberField label="Age" value={form.age} onChange={(value) => updateProfileField("age", value)} />
          <Field label="Gender (optional)">
            <select className="input" value={form.gender} onChange={(e) => updateProfileField("gender", e.target.value)}>
              {genders.map((item) => <option key={item} value={item}>{item || "Select gender"}</option>)}
            </select>
          </Field>
          <NumberField label="Height (cm)" value={form.height} onChange={(value) => updateProfileField("height", value)} />
          <NumberField label="Current Weight (kg)" value={form.weight} onChange={(value) => updateProfileField("weight", value)} />
          <NumberField label="Goal weight (kg)" value={form.goal_weight} onChange={(value) => updateProfileField("goal_weight", value)} />
          <Field label="Fitness Goal">
            <select className="input" value={form.fitness_goal} onChange={(e) => updateProfileField("fitness_goal", e.target.value)}>
              {fitnessGoals.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Activity Level">
            <select className="input" value={form.activity_level} onChange={(e) => updateProfileField("activity_level", e.target.value)}>
              {activityLevels.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <NumberField label="Daily calorie target" value={form.daily_calorie_target} onChange={(value) => updateProfileField("daily_calorie_target", value)} />
          <NumberField label="Daily protein target (g)" value={form.daily_protein_target} onChange={(value) => updateProfileField("daily_protein_target", value)} />
          <div className="md:col-span-2">
            <RecommendationPreview profile={{ ...form, ...recommendations }} />
          </div>
          <div className="md:col-span-2">
            {error && <ErrorBox message={error} />}
            {message && <SuccessBox message={message} />}
            <button className="mt-2 rounded-md bg-leaf px-4 py-2 font-semibold text-white hover:bg-green-700">Save profile</button>
          </div>
        </form>
      </Panel>
    </section>
  );
}

function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-slate-500">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 soft-shadow">
      <h3 className="mb-4 text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}

function StatCard({ label, value, suffix, detail }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 soft-shadow">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}<span className="ml-1 text-base font-semibold text-slate-400">{suffix}</span></p>
      <p className="mt-2 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function ProfileMetric({ label, value, suffix }) {
  return (
    <div className="rounded-md bg-white/80 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-green-700">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}<span className="ml-1 text-sm text-slate-500">{suffix}</span></p>
    </div>
  );
}

function BarChart({ data, valueKey, color, suffix }) {
  const max = Math.max(1, ...data.map((item) => Number(item[valueKey])));
  return (
    <div className="flex h-64 items-end gap-3">
      {data.map((item) => {
        const value = Number(item[valueKey]);
        return (
          <div key={item.date} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-44 w-full items-end rounded-md bg-slate-100 px-1">
              <div className={`bar w-full rounded-t-md ${color}`} style={{ height: `${Math.max(5, (value / max) * 100)}%` }} />
            </div>
            <span className="text-xs font-semibold text-slate-500">{item.date.slice(5)}</span>
            <span className="text-xs text-slate-400">{value}{suffix}</span>
          </div>
        );
      })}
    </div>
  );
}

function CategoryBars({ categories }) {
  const total = categories.reduce((sum, item) => sum + Number(item.calories || 0), 0);
  if (categories.length === 0 || total === 0) return <EmptyState title="No category data" text="Saved meals will appear here." />;
  return (
    <div className="space-y-3">
      {categories.map((item) => {
        const percent = Math.round((Number(item.calories) / total) * 100);
        return (
          <div key={item.category}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-semibold">{item.category}</span>
              <span className="text-slate-500">{item.calories} kcal · {percent}%</span>
            </div>
            <div className="h-3 rounded-full bg-slate-100">
              <div className="bar h-3 rounded-full bg-leaf" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProgressRow({ label, value }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-3 rounded-full bg-slate-100">
        <div className="bar h-3 rounded-full bg-leaf" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Macro({ label, value, suffix }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}<span className="ml-1 text-sm text-slate-400">{suffix}</span></p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <input className="input" type="number" min="1" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Badge({ children }) {
  return <span className="rounded-full bg-mint px-2 py-1 text-xs font-semibold text-green-700">{children}</span>;
}

function EmptyState({ title, text }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <h4 className="font-bold">{title}</h4>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}

function LoadingCard() {
  return <div className="rounded-lg border border-slate-200 bg-white p-6 soft-shadow">Loading...</div>;
}

function ErrorBox({ message }) {
  return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

function SuccessBox({ message }) {
  return <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>;
}

const style = document.createElement("style");
style.textContent = `.input{width:100%;border-radius:0.375rem;border:1px solid rgb(203 213 225);background:white;padding:0.65rem 0.75rem;color:#18212f}.input:focus{border-color:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.12)}`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
