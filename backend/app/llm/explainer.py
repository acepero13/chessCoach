"""
LLM coaching explanations via Ollama Python SDK.
All calls degrade gracefully — a missing/slow LLM never crashes the app.
"""
import json
from ollama import AsyncClient
from app.config import settings

_client = AsyncClient(host=settings.ollama_host)

SYSTEM_PROMPT = (
    "You are a chess coach assistant. You ONLY explain what the chess engine has already "
    "calculated. You do NOT evaluate positions yourself. Translate engine data into concise "
    "educational explanations. Reference concrete engine lines and patterns provided. "
    "Mention a relevant chess principle when appropriate. Never invent variations not given."
)


async def _call_ollama(prompt: str, system: str = SYSTEM_PROMPT) -> str | None:
    """
    Call Ollama. Returns None if unavailable so callers can degrade gracefully.
    """
    try:
        resp = await _client.chat(
            model=settings.ollama_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            options={"temperature": 0.3, "num_predict": 400},
        )
        return resp.message.content.strip()
    except Exception as exc:
        print(f"[llm] Ollama unavailable ({exc})")
        return None


async def explain_mistake(
    move_san: str,
    best_move_san: str,
    fen: str,
    centipawn_loss: float,
    classification: str,
    patterns: list[dict],
    engine_pv: list[str],
    user_rating: int = 1200,
) -> str:
    pattern_text = ""
    if patterns:
        pattern_text = "Patterns detected:\n" + "\n".join(
            f"- {p['type'].replace('_', ' ').title()}: {p['description']}"
            for p in patterns[:3]
        )

    pv_text = f"Engine best continuation: {' '.join(engine_pv[:5])}" if engine_pv else ""

    prompt = f"""Position FEN: {fen}
Player (rated ~{user_rating}) played: {move_san}
Engine best move: {best_move_san}
Centipawn loss: {centipawn_loss:.0f} ({classification})

{pattern_text}
{pv_text}

Explain in 3 short points:
1. Why {move_san} is a {classification}
2. What {best_move_san} achieves (use the engine line)
3. The chess principle this illustrates"""

    result = await _call_ollama(prompt)
    if result is None:
        return (
            f"**{classification.title()}** — played {move_san}, engine prefers {best_move_san} "
            f"({centipawn_loss:.0f} cp loss). "
            + (f"Best line: {' '.join(engine_pv[:4])}" if engine_pv else "")
        )
    return result


async def generate_position_question(
    fen: str,
    pattern_type: str,
    move_number: int,
    color: str,
) -> dict:
    pattern_questions = {
        "missed_fork": "What pieces can you attack simultaneously from here?",
        "missed_pin": "Is there a piece shielding a more valuable piece from your attack?",
        "hanging_piece_missed": "Look carefully — is any opponent piece undefended?",
        "missed_checkmate": "Can you find a move that ends the game immediately?",
        "blunder_hanging": "Your piece became vulnerable. What should you have played instead?",
        "pawn_structure_weakened": "How did this move affect your pawn structure long-term?",
        "strategic_drift": "The position slowly deteriorated. What was the key strategic error?",
        "conversion_failure": "You had a winning advantage. What prevented you from converting?",
    }

    question = pattern_questions.get(pattern_type, "What would you play here and why?")

    hint_prompt = (
        f"FEN: {fen}\nMove {move_number}, {color} to move. "
        f"Theme: {pattern_type.replace('_', ' ')}.\n"
        "Give a 1-sentence hint guiding toward the correct idea WITHOUT revealing the move."
    )

    hint = await _call_ollama(hint_prompt)
    if hint is None:
        hints = {
            "missed_fork": "Look for a piece that can attack two targets at once.",
            "missed_pin": "Check if any piece is stuck defending a more valuable one behind it.",
            "hanging_piece_missed": "Count the defenders — is something left unprotected?",
            "missed_checkmate": "The king has very few escape squares right now.",
            "blunder_hanging": "After your move, check if any of your pieces can be taken for free.",
        }
        hint = hints.get(pattern_type, "Think carefully before moving — what does your opponent threaten?")

    return {
        "question_type": "motif_identification" if "missed" in pattern_type else "calculation",
        "question": question,
        "hint": hint,
    }


async def generate_batch_summary(
    scores: dict,
    top_patterns: list[dict],
    games_analyzed: int,
) -> str:
    weaknesses = [k for k, v in sorted(scores.items(), key=lambda x: x[1])[:3]]
    strengths = [k for k, v in sorted(scores.items(), key=lambda x: x[1], reverse=True)[:2]]

    pattern_counts: dict[str, int] = {}
    for p in top_patterns:
        ptype = p["type"]
        pattern_counts[ptype] = pattern_counts.get(ptype, 0) + 1
    top_issues = sorted(pattern_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    issues_text = ", ".join(f"{k.replace('_', ' ')} ({v}x)" for k, v in top_issues) or "none detected"

    prompt = f"""Chess performance data from {games_analyzed} games:

Scores (0–100):
{json.dumps(scores, indent=2)}

Biggest weaknesses: {', '.join(weaknesses)}
Biggest strengths: {', '.join(strengths)}
Most frequent issues: {issues_text}

Write a 3-paragraph coaching summary:
1. Overall assessment of the player's style and level
2. The 2–3 most critical areas to improve with specific observations
3. Encouragement and the single most important focus for next training cycle

Base everything strictly on the numbers above."""

    result = await _call_ollama(prompt)
    if result is None:
        score_lines = "\n".join(f"- {k}: {v:.0f}/100" for k, v in scores.items())
        return (
            f"Analysis of {games_analyzed} games complete.\n\n"
            f"**Scores:**\n{score_lines}\n\n"
            f"**Focus areas:** {', '.join(weaknesses)}\n"
            f"**Strengths:** {', '.join(strengths)}\n\n"
            "(AI narrative unavailable — Ollama not reachable)"
        )
    return result
