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
    engine_pv_san: list[str],
    user_rating: int = 1200,
    student_move_san: str = "",
    student_cp_loss: float | None = None,
    student_classification: str = "",
) -> str:
    """
    Build a coaching explanation where all chess facts are deterministic (Python-computed)
    and the LLM only adds a brief conceptual note — it never touches the position or PV.
    """
    parts = []

    # --- Section 1: Student's suggestion vs game move ---
    if student_move_san and student_move_san != move_san:
        if student_cp_loss is not None:
            if student_cp_loss < centipawn_loss - 10:
                verdict = "better than what was played"
            elif student_cp_loss > centipawn_loss + 10:
                verdict = "worse than what was played"
            else:
                verdict = "about the same as what was played"
            parts.append(
                f"Your suggestion — {student_move_san} "
                f"({student_cp_loss:.0f} cp, {student_classification}): {verdict}."
            )
        else:
            parts.append(f"Your suggestion — {student_move_san}: legal move, see engine comparison below.")
    elif student_move_san and student_move_san == move_san:
        parts.append(
            f"You found the game move ({move_san}), "
            f"which was a {classification} ({centipawn_loss:.0f} cp loss)."
        )

    # --- Section 2: What was played in the game ---
    parts.append(
        f"In the game — {move_san}: "
        f"a {classification} ({centipawn_loss:.0f} cp loss)."
    )

    # --- Section 3: Engine recommendation (all facts from Python, not LLM) ---
    if engine_pv_san:
        parts.append(f"Engine best line — {' '.join(engine_pv_san)}")
    else:
        parts.append(f"Engine best move — {best_move_san}")

    # --- Section 4: LLM adds ONE short conceptual note only ---
    # The LLM is NOT given the FEN and is NOT asked to explain the position.
    # It only gets the move names and PV so it can comment on the chess idea abstractly.
    pv_str = " ".join(engine_pv_san[:5]) if engine_pv_san else best_move_san
    concept_prompt = (
        f"A chess player played {move_san} (a {classification}, {centipawn_loss:.0f} cp loss). "
        f"The engine recommends {best_move_san} with the continuation: {pv_str}. "
        f"In exactly ONE sentence, state what chess idea {best_move_san} embodies "
        f"(e.g. development, piece activity, king safety, initiative, coordination). "
        f"Do NOT invent moves. Do NOT mention specific squares beyond those already listed."
    )
    concept = await _call_ollama(concept_prompt)
    if concept:
        parts.append(f"Key idea — {concept}")

    return "\n\n".join(parts)


async def generate_position_question(
    fen: str,
    pattern_type: str,
    move_number: int,
    color: str,
    best_move_san: str = "",
    centipawn_loss: float = 0.0,
    classification: str = "mistake",
) -> dict:
    pattern_questions = {
        "missed_fork": "Can you spot a move that attacks two pieces at once?",
        "missed_pin": "Is any opponent piece stuck defending a more valuable piece behind it?",
        "hanging_piece_missed": "Is every opponent piece defended? Look carefully.",
        "missed_checkmate": "Can you find a move that ends the game immediately?",
        "blunder_hanging": "After your move, could any of your pieces be captured for free?",
        "pawn_structure_weakened": "How does this pawn move change your long-term structure?",
        "isolated_pawn_created": "Does this move leave any of your pawns without pawn support?",
        "weak_squares_created": "Does this move create squares your opponent can permanently occupy?",
        "strategic_drift": "The position slowly deteriorated — what was the key strategic error?",
        "bishop_knight_trade_bad": "Given the pawn structure, is trading bishop for knight the right decision here?",
        "bishop_knight_trade_ok": "What makes this piece exchange appropriate in this position?",
    }

    question = pattern_questions.get(pattern_type, "What would you play here and why?")

    # Build a grounded hint using actual engine data — the LLM must not infer from the FEN alone.
    if best_move_san:
        hint_prompt = (
            f"You are a chess coach. The engine's best move in this position is {best_move_san} "
            f"(this is a {classification}, {centipawn_loss:.0f} cp loss if missed).\n"
            f"Theme: {pattern_type.replace('_', ' ')}.\n\n"
            f"Write exactly ONE sentence hinting toward {best_move_san} WITHOUT naming the destination "
            f"square or the piece type directly. The hint must be a general directional clue "
            f"(e.g. about activity, safety, threats, or coordination) that guides the student "
            f"without giving away the answer. Do not mention any specific square or piece name."
        )
    else:
        hint_prompt = (
            f"FEN: {fen}\nMove {move_number}, {color} to move. "
            f"Theme: {pattern_type.replace('_', ' ')}.\n"
            "Give exactly 1 sentence hinting at the correct idea WITHOUT revealing the move. "
            "Only mention things that are literally present in the position."
        )

    hint = await _call_ollama(hint_prompt)
    if hint is None:
        hints = {
            "missed_fork": "Look for a piece that can leap to a square attacking two targets simultaneously.",
            "missed_pin": "Check if any opponent piece is stuck in front of a more valuable piece.",
            "hanging_piece_missed": "Count defenders on every opponent piece — something may be left unprotected.",
            "missed_checkmate": "The enemy king has very few escape squares right now.",
            "blunder_hanging": "After your intended move, verify all your pieces are safe from capture.",
            "pawn_structure_weakened": "Consider how the resulting pawn formation affects your long-term play.",
            "isolated_pawn_created": "A pawn without pawn neighbors becomes a permanent weakness.",
            "weak_squares_created": "Think about which squares this move hands over to your opponent permanently.",
            "strategic_drift": "Look for the move that best improves your worst-placed piece.",
            "bishop_knight_trade_bad": "In this structure, which minor piece is more active long-term?",
        }
        hint = hints.get(pattern_type, "Think about your opponent's best reply before committing.")

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
