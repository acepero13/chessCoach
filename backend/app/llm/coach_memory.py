"""
Coach memory — persistent cross-session context that makes the coach feel like
it knows the player.

The coach remembers:
  - What was worked on in previous sessions
  - Recurring error patterns across games
  - Score deltas (progress or regression since last profile)
  - Whether a training plan was assigned and acknowledged

All LLM calls use COACH_PERSONA instead of the engine-translation system prompt,
giving the coach a consistent voice that speaks directly to the player.
"""
import json
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CoachMemory
from app.llm.explainer import _call_ollama, LLM_TIMEOUT_SHORT, LLM_TIMEOUT_LONG


COACH_PERSONA = (
    "You are a direct, experienced chess coach with a strong memory for your students. "
    "You speak personally and specifically — you reference this player's actual history, "
    "patterns, and progress. You are never generic. You never say 'in chess' or give "
    "textbook advice disconnected from this player's data. You are concise (2-3 sentences max). "
    "You do not evaluate positions yourself — you use engine data provided to you."
)


# ---------------------------------------------------------------------------
# Memory CRUD
# ---------------------------------------------------------------------------

async def get_or_create_memory(user_id: int, db: AsyncSession) -> CoachMemory:
    result = await db.execute(select(CoachMemory).where(CoachMemory.user_id == user_id))
    memory = result.scalar_one_or_none()
    if memory is None:
        memory = CoachMemory(user_id=user_id)
        db.add(memory)
        await db.commit()
        await db.refresh(memory)
    return memory


# ---------------------------------------------------------------------------
# Coach opening message
# ---------------------------------------------------------------------------

async def generate_coach_opening(
    memory: CoachMemory,
    current_scores: dict,
    game_info: dict,   # {opponent, result, opening_name, user_color}
) -> str:
    """
    Generate the coach's opening message for this session.
    First session: introduces self and names what stands out from the scores.
    Subsequent sessions: references what was worked on, notes score deltas,
    asks about the training plan if pending.
    """
    is_first = (memory.sessions_completed or 0) == 0
    opponent   = game_info.get("opponent") or "your opponent"
    result     = game_info.get("result") or "unknown"
    opening    = game_info.get("opening_name") or ""
    user_color = game_info.get("user_color") or "white"

    prev_scores   = memory.previous_scores or {}
    patterns      = memory.recurring_patterns or []
    last_focus    = memory.last_session_focus or {}

    # Score deltas vs last profile
    deltas = []
    for k, v in current_scores.items():
        prev = prev_scores.get(k)
        if prev is not None:
            diff = v - prev
            if abs(diff) >= 3:
                direction = "up" if diff > 0 else "down"
                deltas.append(f"{k} {direction} {abs(diff):.0f} pts")

    # ---- First session ----
    if is_first:
        weakest  = min(current_scores, key=current_scores.get)
        strongest = max(current_scores, key=current_scores.get)
        prompt = (
            f"A player is starting their very first coaching session.\n"
            f"Their scores (0-100): {json.dumps(current_scores)}\n"
            f"Today's game: {user_color} vs {opponent}, result: {result}"
            + (f", opening: {opening}" if opening else "") + ".\n\n"
            f"Write 2-3 sentences as their coach opening this session. "
            f"Immediately name their strongest area ({strongest}: {current_scores[strongest]:.0f}) "
            f"and their biggest weakness ({weakest}: {current_scores[weakest]:.0f}). "
            f"Then pivot to this game. "
            f"Do NOT say 'welcome' or 'let's get started'. Be direct."
        )

    # ---- Returning player ----
    else:
        last_lesson  = last_focus.get("key_lesson") or ""
        plan_pending = memory.training_plan_pending

        context = [f"This player has done {memory.sessions_completed} session(s) with you."]
        if memory.player_narrative:
            context.append(f"Your note on them: {memory.player_narrative}")
        if last_lesson:
            context.append(f"Last session you focused on: {last_lesson}.")
        if patterns:
            context.append(f"Recurring patterns you've noticed: {', '.join(patterns[:3])}.")
        if deltas:
            context.append(f"Score changes since last session: {'; '.join(deltas)}.")
        if plan_pending:
            context.append("You assigned them a training plan — you haven't heard if they worked on it.")

        prompt = (
            "\n".join(context) + "\n\n"
            f"Today's game: {user_color} vs {opponent}, result: {result}"
            + (f", opening: {opening}" if opening else "") + ".\n\n"
            f"Write 2-3 sentences opening this session. "
            f"Reference what you remember — prior work, score changes, or the training plan. "
            f"Then set context for today's game. "
            f"Be specific and personal. Do NOT say 'let's get started' or 'great to see you'."
        )

    text = await _call_ollama(
        prompt, system=COACH_PERSONA, num_predict=200, timeout=LLM_TIMEOUT_LONG
    )
    if text:
        return text

    # Deterministic fallback
    if is_first:
        weakest = min(current_scores, key=current_scores.get)
        return (
            f"Today we're reviewing your {result} as {user_color} against {opponent}. "
            f"Based on your profile, {weakest.replace('_', ' ')} is the area that needs the most attention. "
            f"Let's see how it shows up in this game."
        )
    else:
        parts = [f"Session {(memory.sessions_completed or 0) + 1}."]
        if last_lesson:
            parts.append(f"Last time we worked on {last_lesson}.")
        if deltas:
            parts.append(f"Since then: {'; '.join(deltas[:2])}.")
        parts.append(f"Today: your {result} as {user_color} against {opponent}.")
        return " ".join(parts)


# ---------------------------------------------------------------------------
# Game arc narrative
# ---------------------------------------------------------------------------

async def generate_game_arc(
    evals: list[dict],
    user_color: str,
    result: str,
) -> str:
    """
    2-sentence story of how the game unfolded based on the eval curve.
    Shown to the player before the first critical position — sets context
    so the review feels like a narrative, not a random jump to mistakes.
    """
    user_evals = [e for e in evals if e.get("color") == user_color]
    if len(user_evals) < 3:
        return ""

    points = [(e["move_number"], e["eval_before"]) for e in user_evals]

    def phase_label(vals: list[float]) -> str:
        if not vals:
            return "unclear"
        avg = sum(vals) / len(vals)
        if avg > 250:   return "clearly winning"
        if avg > 100:   return "slightly better"
        if avg > -100:  return "roughly equal"
        if avg > -250:  return "slightly worse"
        return "under pressure"

    opening_vals  = [v for m, v in points if m <= 10]
    middle_vals   = [v for m, v in points if 10 < m <= 25]
    late_vals     = [v for m, v in points if m > 25]
    peak          = max(points, key=lambda x: x[1])
    final         = points[-1]

    worst = max(user_evals, key=lambda e: e.get("centipawn_loss", 0), default=None)

    summary = (
        f"Opening: {phase_label(opening_vals)}. "
        f"Middlegame: {phase_label(middle_vals)}. "
        + (f"Endgame: {phase_label(late_vals)}. " if late_vals else "")
        + f"Peak advantage: move {peak[0]}, {peak[1]/100:+.1f} pawns. "
        f"Final eval: {final[1]/100:+.1f} pawns. Result: {result}."
    )
    if worst:
        summary += (
            f" Worst error: {worst['move_san']} on move {worst['move_number']} "
            f"({worst['centipawn_loss']:.0f} cp loss, {worst['classification']})."
        )

    prompt = (
        f"Chess game data:\n{summary}\n\n"
        f"Write exactly 2 sentences describing the story of this game from the player's perspective. "
        f"Be specific about when it was going well vs. when it went wrong. "
        f"Example: 'You were equal through the opening and built a clear edge by move 18, "
        f"but a blunder on move 24 gave back all the advantage.' "
        f"Only use data above. Do not invent moves or squares."
    )

    arc = await _call_ollama(
        prompt, system=COACH_PERSONA, num_predict=150, timeout=LLM_TIMEOUT_SHORT
    )
    if arc:
        return arc

    # Deterministic fallback
    opening_desc = phase_label(opening_vals)
    middle_desc  = phase_label(middle_vals)
    if peak[1] > 150 and final[1] < 0:
        return (
            f"You reached a {phase_label([peak[1]])} position by move {peak[0]}, "
            f"but the advantage slipped away and the game ended in a {result}."
        )
    return f"The game was {opening_desc} in the opening and {middle_desc} through the middlegame, finishing as a {result}."


# ---------------------------------------------------------------------------
# Mental coaching note (inline — for blunders in winning positions)
# ---------------------------------------------------------------------------

async def generate_mental_note(
    move_san: str,
    eval_before: float,
    classification: str,
    recurring_patterns: list[str],
) -> str | None:
    """
    Short (1-sentence) behavioral note shown when the player blundered
    from a winning position — integrates mental coaching into the session
    without requiring a separate page.
    """
    was_winning_pattern = any(
        "rush" in p or "winning" in p or "conversion" in p or "relax" in p
        for p in recurring_patterns
    )

    prompt = (
        f"A chess player blundered ({move_san}, {classification}) "
        f"when they were {eval_before/100:.1f} pawns ahead — a clearly winning position.\n"
        + (f"This pattern has appeared before in their sessions.\n" if was_winning_pattern else "")
        + "Write exactly 1 sentence of behavioral coaching. "
        "Focus on the mental pattern (rushing, relaxing, overcomplicating), NOT the chess move. "
        "Be direct. Example: 'When you're this far ahead, you tend to rush — slow down and look for checks.'"
    )

    return await _call_ollama(
        prompt, system=COACH_PERSONA, num_predict=80, timeout=LLM_TIMEOUT_SHORT
    )


# ---------------------------------------------------------------------------
# Update memory after session completes
# ---------------------------------------------------------------------------

async def update_memory_after_session(
    memory: CoachMemory,
    interactions: list[dict],
    game_id: int,
    current_scores: dict,
    db: AsyncSession,
) -> None:
    """
    Called when a coaching session closes. Updates:
    - recurring_patterns (accumulates across sessions)
    - last_session_focus (what was reviewed today)
    - previous_scores (for next session's delta)
    - sessions_completed counter
    - player_narrative (refreshed every 3 sessions via LLM)
    """
    # Collect patterns seen in this session
    session_patterns: list[str] = []
    for interaction in interactions:
        for p in interaction.get("patterns", []):
            t = p.get("type", "")
            if t:
                session_patterns.append(t)

    # Accumulate recurring patterns (keep unique, cap at 6)
    recurring = list(memory.recurring_patterns or [])
    for p in session_patterns:
        if p not in recurring:
            recurring.append(p)
    memory.recurring_patterns = recurring[:6]

    # Determine the key lesson of this session
    pattern_counts: dict[str, int] = {}
    for p in session_patterns:
        pattern_counts[p] = pattern_counts.get(p, 0) + 1
    top_pattern = (
        max(pattern_counts, key=pattern_counts.get) if pattern_counts else None
    )
    key_lesson = top_pattern.replace("_", " ") if top_pattern else (
        f"{len(interactions)} critical position(s) reviewed"
    )

    # Detect if player blundered in winning positions (for future opening messages)
    winning_blunders = sum(
        1 for i in interactions
        if i.get("eval_before", 0) > 200 and i.get("classification") == "blunder"
    )
    if winning_blunders > 0 and "rushes when winning" not in memory.recurring_patterns:
        memory.recurring_patterns = (memory.recurring_patterns or []) + ["rushes when winning"]

    memory.last_session_focus = {
        "game_id": game_id,
        "patterns": list(set(session_patterns))[:3],
        "key_lesson": key_lesson,
        "session_number": (memory.sessions_completed or 0) + 1,
    }

    memory.previous_scores    = current_scores
    memory.sessions_completed = (memory.sessions_completed or 0) + 1
    memory.last_seen          = datetime.utcnow()
    memory.updated_at         = datetime.utcnow()

    # Refresh player narrative every 3 sessions
    if memory.sessions_completed % 3 == 0 and current_scores:
        weakest   = min(current_scores, key=current_scores.get)
        strongest = max(current_scores, key=current_scores.get)
        narrative_prompt = (
            f"A chess player has completed {memory.sessions_completed} coaching sessions.\n"
            f"Strongest area: {strongest} ({current_scores[strongest]:.0f}/100).\n"
            f"Weakest area: {weakest} ({current_scores[weakest]:.0f}/100).\n"
            f"Recurring patterns: {', '.join((memory.recurring_patterns or [])[:4]) or 'none yet'}.\n\n"
            f"Write 1-2 sentences summarizing who this player is as a chess player — "
            f"their style, main strength, main weakness. "
            f"This is a private coach note, not shown to the player. Be blunt."
        )
        narrative = await _call_ollama(
            narrative_prompt, system=COACH_PERSONA, num_predict=100, timeout=LLM_TIMEOUT_SHORT
        )
        if narrative:
            memory.player_narrative = narrative

    await db.commit()
