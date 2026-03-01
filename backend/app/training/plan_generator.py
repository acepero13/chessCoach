"""
Deterministic 4-week training plan generator.
Fully derived from the performance profile — no randomness.
"""
from dataclasses import dataclass, field


@dataclass
class DailySession:
    day: int                    # 1–7
    tactics_puzzles: int
    endgame_drills: bool
    opening_review: bool
    rated_games: int
    self_review: bool
    estimated_minutes: int
    focus_areas: list[str]
    drill_types: list[str]


@dataclass
class Week:
    week_number: int
    theme: str
    daily_sessions: list[DailySession]
    total_minutes: int
    recommended_time_control: str


@dataclass
class TrainingPlan:
    weeks: list[Week]
    primary_weakness: str
    secondary_weakness: str
    notes: list[str]
    total_hours: float


DRILL_MAP = {
    "tactics": {
        "missed_fork": "Fork puzzles (knight & bishop forks, double attacks)",
        "missed_pin": "Pin & skewer puzzles",
        "hanging_piece_missed": "Hanging piece detection drills",
        "missed_checkmate": "Checkmate in 1–3 puzzles",
        "blunder_hanging": "Blunder-check habit training",
    },
    "endgame": {
        "endgame_blunder": "Rook vs King endgame technique",
        "conversion_failure": "Convert winning endgames (K+P, R+P vs R)",
    },
    "opening": {
        "opening_mistake": "Repertoire review and opening traps study",
    },
    "strategy": {
        "pawn_structure_weakened": "Pawn structure principles (weak squares, islands)",
        "strategic_drift": "Prophylaxis and long-term planning exercises",
        "weak_squares_created": "Outpost and weak square exploitation drills",
    },
    "defense": {
        "blunders_under_attack": "Defensive resources recognition",
    },
    "mental_stability": {
        "blunder_clusters": "Tilt recovery: slow down after mistakes exercises",
    },
}

TIME_CONTROLS = {
    "tactics": "Bullet (1+0) for pattern speed",
    "endgame": "Classical (15+10) for calculation",
    "opening": "Rapid (10+5) for opening practice",
    "strategy": "Classical (15+10) for strategic games",
    "default": "Rapid (10+5)",
}


def _get_score(profile: dict, key: str) -> float:
    return profile.get(f"{key}_score", profile.get(key, 50.0))


def _identify_weaknesses(profile: dict) -> list[tuple[str, float]]:
    domains = [
        "attack", "defense", "opening", "strategy",
        "endgame", "tactics", "time_management", "conversion", "mental_stability"
    ]
    scored = [(d, _get_score(profile, d)) for d in domains]
    return sorted(scored, key=lambda x: x[1])


def _build_drills_for_weakness(weakness: str, profile: dict) -> list[str]:
    drills = []
    domain_drills = DRILL_MAP.get(weakness, {})
    for key, description in domain_drills.items():
        drills.append(description)
    if not drills:
        drills.append(f"General {weakness} improvement exercises")
    return drills


def _build_week(
    week_num: int,
    primary: str,
    secondary: str,
    primary_score: float,
    secondary_score: float,
    profile: dict,
) -> Week:
    """Build a single week of training."""
    primary_drills = _build_drills_for_weakness(primary, profile)
    secondary_drills = _build_drills_for_weakness(secondary, profile)

    # Tactics intensity scales with how bad the score is
    tactics_per_session = max(5, int((100 - _get_score(profile, "tactics")) / 5))
    if primary == "tactics":
        tactics_per_session = min(30, tactics_per_session + 10)

    endgame_focus = primary in ("endgame", "conversion") or secondary in ("endgame", "conversion")
    opening_focus = primary == "opening" or secondary == "opening"

    # Recommended time control
    time_control = TIME_CONTROLS.get(primary, TIME_CONTROLS["default"])

    # Week theme
    themes = {
        1: f"Foundation — Identifying {primary} patterns",
        2: f"Practice — Drilling {primary} & {secondary}",
        3: f"Integration — Mixed training with focus on {primary}",
        4: "Consolidation — Rated games + self-review",
    }
    theme = themes.get(week_num, f"Week {week_num} training")

    sessions = []
    for day in range(1, 8):
        is_rest_day = day == 7
        is_endgame_day = endgame_focus and day in (2, 4, 6)
        is_opening_day = opening_focus and day == 3
        is_review_day = day == 6

        rated_games = 0 if is_rest_day else (5 if day in (4, 5) else 2)
        tactics_count = 0 if is_rest_day else tactics_per_session
        drills = []

        if not is_rest_day:
            drills.extend(primary_drills[:2])
            if day % 2 == 0:
                drills.extend(secondary_drills[:1])

        minutes = 0
        if not is_rest_day:
            minutes += tactics_count * 1        # ~1 min per puzzle
            minutes += 20 if is_endgame_day else 0
            minutes += 15 if is_opening_day else 0
            minutes += rated_games * 15          # ~15 min per rapid game
            minutes += 30 if is_review_day else 0

        sessions.append(DailySession(
            day=day,
            tactics_puzzles=tactics_count,
            endgame_drills=is_endgame_day,
            opening_review=is_opening_day,
            rated_games=rated_games,
            self_review=is_review_day,
            estimated_minutes=minutes,
            focus_areas=[primary, secondary] if not is_rest_day else [],
            drill_types=drills,
        ))

    total_minutes = sum(s.estimated_minutes for s in sessions)
    return Week(
        week_number=week_num,
        theme=theme,
        daily_sessions=sessions,
        total_minutes=total_minutes,
        recommended_time_control=time_control,
    )


def generate_training_plan(profile: dict) -> TrainingPlan:
    """
    Generate a 4-week deterministic training plan from a performance profile dict.
    """
    weaknesses = _identify_weaknesses(profile)
    primary_weakness, primary_score = weaknesses[0]
    secondary_weakness, secondary_score = weaknesses[1]

    weeks = []
    for week_num in range(1, 5):
        week = _build_week(
            week_num=week_num,
            primary=primary_weakness,
            secondary=secondary_weakness,
            primary_score=primary_score,
            secondary_score=secondary_score,
            profile=profile,
        )
        weeks.append(week)

    total_hours = sum(w.total_minutes for w in weeks) / 60

    notes = []
    if primary_score < 40:
        notes.append(
            f"Critical weakness in {primary_weakness} (score: {primary_score:.0f}/100). "
            "Prioritize this above all else this month."
        )
    if _get_score(profile, "tactics") < 60:
        notes.append(
            "Tactics score below 60 — do puzzles EVERY day before any other training."
        )
    if _get_score(profile, "time_management") < 50:
        notes.append(
            "Time management issues detected — practice with a clock for all positions, "
            "never skip timed games."
        )

    return TrainingPlan(
        weeks=weeks,
        primary_weakness=primary_weakness,
        secondary_weakness=secondary_weakness,
        notes=notes,
        total_hours=round(total_hours, 1),
    )


def plan_to_dict(plan: TrainingPlan) -> dict:
    """Serialize training plan to JSON-compatible dict."""
    def session_dict(s: DailySession) -> dict:
        return {
            "day": s.day,
            "tactics_puzzles": s.tactics_puzzles,
            "endgame_drills": s.endgame_drills,
            "opening_review": s.opening_review,
            "rated_games": s.rated_games,
            "self_review": s.self_review,
            "estimated_minutes": s.estimated_minutes,
            "focus_areas": s.focus_areas,
            "drill_types": s.drill_types,
        }

    def week_dict(w: Week) -> dict:
        return {
            "week_number": w.week_number,
            "theme": w.theme,
            "daily_sessions": [session_dict(s) for s in w.daily_sessions],
            "total_minutes": w.total_minutes,
            "recommended_time_control": w.recommended_time_control,
        }

    return {
        "primary_weakness": plan.primary_weakness,
        "secondary_weakness": plan.secondary_weakness,
        "notes": plan.notes,
        "total_hours": plan.total_hours,
        "weeks": [week_dict(w) for w in plan.weeks],
    }
