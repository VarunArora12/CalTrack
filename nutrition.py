from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Food:
    name: str
    serving: str
    calories: int
    protein: float
    carbs: float
    fat: float
    aliases: tuple[str, ...]


FOODS = [
    Food("Paratha", "1 medium", 220, 6, 32, 8, ("paratha", "parathas", "aloo paratha")),
    Food("Curd", "1 bowl", 95, 5, 7, 5, ("curd", "dahi", "yogurt", "yoghurt")),
    Food("Paneer Sandwich", "1 sandwich", 410, 20, 42, 18, ("paneer sandwich", "paneer toast")),
    Food("Chicken Biryani", "1 plate", 650, 32, 78, 22, ("chicken biryani", "biryani")),
    Food("Oats", "1 bowl", 160, 6, 28, 3, ("oats", "oatmeal")),
    Food("Milk", "1 cup", 120, 8, 12, 5, ("milk", "doodh")),
    Food("Banana", "1 medium", 105, 1.3, 27, 0.4, ("banana", "bananas")),
    Food("Egg", "1 egg", 78, 6, 0.6, 5, ("egg", "eggs", "boiled egg", "omelette")),
    Food("Rice", "1 cup cooked", 205, 4, 45, 0.4, ("rice", "chawal")),
    Food("Dal", "1 bowl", 180, 10, 28, 4, ("dal", "daal", "lentils")),
    Food("Roti", "1 roti", 110, 3, 22, 1, ("roti", "rotis", "chapati", "chapatis")),
    Food("Chicken Breast", "100 g", 165, 31, 0, 3.6, ("chicken breast", "grilled chicken", "chicken")),
    Food("Paneer", "100 g", 265, 18, 6, 20, ("paneer", "cottage cheese")),
    Food("Poha", "1 plate", 250, 6, 46, 5, ("poha",)),
    Food("Idli", "2 idlis", 150, 5, 30, 1, ("idli", "idlis")),
    Food("Dosa", "1 dosa", 170, 4, 28, 5, ("dosa", "dosas")),
    Food("Upma", "1 bowl", 260, 7, 45, 6, ("upma",)),
    Food("Apple", "1 medium", 95, 0.5, 25, 0.3, ("apple", "apples")),
    Food("Peanut Butter Toast", "1 toast", 280, 10, 25, 16, ("peanut butter toast", "pb toast")),
    Food("Protein Shake", "1 scoop with water", 130, 24, 4, 2, ("protein shake", "whey", "whey protein")),
    Food("Salad", "1 bowl", 120, 4, 16, 5, ("salad", "veg salad", "vegetable salad")),
    Food("Samosa", "1 piece", 260, 5, 30, 14, ("samosa", "samosas")),
    Food("Pasta", "1 bowl", 430, 14, 70, 11, ("pasta",)),
    Food("Rajma", "1 bowl", 220, 12, 36, 4, ("rajma", "kidney beans")),
]

NUMBER_WORDS = {
    "half": 0.5,
    "one": 1,
    "a": 1,
    "an": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
}


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def find_quantity(text: str, start: int) -> float:
    window = text[max(0, start - 28) : start].strip()
    matches = re.findall(r"(\d+(?:\.\d+)?|half|one|two|three|four|five|six|a|an)\s*(?:cups?|bowls?|plates?|pieces?|medium|large|small|servings?)?$", window)
    if not matches:
        return 1.0
    value = matches[-1]
    return NUMBER_WORDS.get(value, float(value) if re.match(r"\d", value) else 1.0)


def search_foods(query: str) -> list[dict]:
    q = clean_text(query)
    if not q:
        return []
    results = []
    for food in FOODS:
        haystack = " ".join((food.name, *food.aliases)).lower()
        if q in haystack:
            results.append(food_to_dict(food))
    return results[:8]


def food_to_dict(food: Food) -> dict:
    return {
        "name": food.name,
        "serving": food.serving,
        "calories": food.calories,
        "protein": food.protein,
        "carbs": food.carbs,
        "fat": food.fat,
        "aliases": list(food.aliases),
    }


def analyze_description(description: str) -> dict:
    """Estimate nutrition by matching common food names and quantities in the user's sentence."""
    text = clean_text(description)
    matched_spans: list[tuple[int, int]] = []
    items = []

    aliases = []
    for food in FOODS:
        for alias in food.aliases:
            aliases.append((alias, food))
    aliases.sort(key=lambda pair: len(pair[0]), reverse=True)

    for alias, food in aliases:
        pattern = re.compile(rf"(?<![a-z]){re.escape(alias)}(?![a-z])")
        for match in pattern.finditer(text):
            span = match.span()
            if any(not (span[1] <= taken[0] or span[0] >= taken[1]) for taken in matched_spans):
                continue
            quantity = find_quantity(text, span[0])
            matched_spans.append(span)
            items.append(
                {
                    "food": food.name,
                    "serving": food.serving,
                    "quantity": quantity,
                    "calories": round(food.calories * quantity),
                    "protein": round(food.protein * quantity, 1),
                    "carbs": round(food.carbs * quantity, 1),
                    "fat": round(food.fat * quantity, 1),
                }
            )
            break

    if not items:
        words = max(1, len(text.split()))
        fallback_calories = min(700, max(180, words * 45))
        items.append(
            {
                "food": "Estimated mixed meal",
                "serving": "1 serving",
                "quantity": 1,
                "calories": fallback_calories,
                "protein": round(fallback_calories * 0.14 / 4, 1),
                "carbs": round(fallback_calories * 0.5 / 4, 1),
                "fat": round(fallback_calories * 0.32 / 9, 1),
            }
        )

    totals = {
        "calories": round(sum(item["calories"] for item in items)),
        "protein": round(sum(item["protein"] for item in items), 1),
        "carbs": round(sum(item["carbs"] for item in items), 1),
        "fat": round(sum(item["fat"] for item in items), 1),
    }
    confidence = 85 if len(items) > 1 else 72
    if items[0]["food"] == "Estimated mixed meal":
        confidence = 45

    return {
        "description": description.strip(),
        "normalized_name": ", ".join(item["food"] for item in items[:3]),
        "items": items,
        "totals": totals,
        "confidence": confidence,
        "note": "Estimates use a small built-in food database and common serving sizes.",
    }
