"""
LLM coaching explanations via Ollama Python SDK.
All calls degrade gracefully — a missing/slow LLM never crashes the app.

Thinking-model support (Qwen3, DeepSeek-R1, QwQ, etc.) — requires ollama SDK >= 0.6:
  - Detected automatically from the model name in settings.
  - For thinking models, think=False is passed to Ollama so the model answers
    directly without generating a chain-of-thought block.  This is much faster
    and avoids consuming num_predict tokens on reasoning before the actual answer.
  - As a safety net, any <think>…</think> blocks that slip through are stripped
    from the returned content before it reaches callers.
"""
import re
import json
import asyncio
from ollama import AsyncClient
from app.config import settings

_client = AsyncClient(host=settings.ollama_host)

# Hard timeout per LLM call so a slow model never blocks the HTTP response.
# Single-sentence outputs use LLM_TIMEOUT_SHORT; longer outputs use LLM_TIMEOUT_LONG.
LLM_TIMEOUT_SHORT = 40   # seconds — for 1-sentence outputs (~120 tokens)
LLM_TIMEOUT_LONG  = 70   # seconds — for 2-3 sentence / paragraph outputs (~300 tokens)

SYSTEM_PROMPT = (
    "You are a chess coach assistant. You ONLY explain what the chess engine has already "
    "calculated. You do NOT evaluate positions yourself. Translate engine data into concise "
    "educational explanations. Reference concrete engine lines and patterns provided. "
    "Mention a relevant chess principle when appropriate. Never invent variations not given."
)

# Known thinking-model name fragments (case-insensitive match against settings.ollama_model).
_THINKING_MODEL_PATTERNS = ("qwen", "deepseek-r1", "qwq", "qvq")


def _is_thinking_model() -> bool:
    """Return True if the configured Ollama model is a known chain-of-thought/thinking model."""
    name = settings.ollama_model.lower()
    return any(p in name for p in _THINKING_MODEL_PATTERNS)


def _strip_thinking(text: str) -> str:
    """
    Remove <think>…</think> blocks emitted by reasoning models.
    Safety net — normally thinking is disabled via think=False in _call_ollama.
    """
    stripped = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    return stripped.strip()


async def _call_ollama(
    prompt: str,
    system: str = SYSTEM_PROMPT,
    num_predict: int = 200,
    timeout: float = LLM_TIMEOUT_LONG,
) -> str | None:
    """
    Call Ollama with a hard timeout. Returns None on any failure so callers degrade gracefully.
    For thinking models (Qwen3 etc.), think=False is passed so the model skips chain-of-thought.
    """
    is_thinking = _is_thinking_model()

    async def _chat() -> str:
        kwargs = dict(
            model=settings.ollama_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            options={"temperature": 0.3, "num_predict": num_predict},
        )
        if is_thinking:
            kwargs["think"] = False   # SDK >= 0.6: disable chain-of-thought for faster responses
        resp = await _client.chat(**kwargs)
        raw = resp.message.content.strip()
        return _strip_thinking(raw)   # strip any stray <think> blocks as safety net

    try:
        return await asyncio.wait_for(_chat(), timeout=timeout)
    except asyncio.TimeoutError:
        print(f"[llm] Ollama timed out after {timeout}s")
        return None
    except Exception as exc:
        print(f"[llm] Ollama unavailable ({exc})")
        return None


PATTERN_TIP_NAMES = {
    "hanging_piece_missed": "missing hanging pieces",
    "missed_fork": "missing fork opportunities",
    "missed_pin": "missing pin opportunities",
    "missed_checkmate": "missing checkmate opportunities",
    "fork": "missing fork opportunities",
    "pin": "missing pin opportunities",
    "pawn_structure_weakened": "weakening pawn structure",
    "isolated_pawn_created": "creating isolated pawns",
    "weak_squares_created": "creating weak squares",
    "strategic_drift": "strategic drift (slow positional decline)",
    "bishop_knight_trade_bad": "making poor bishop-knight trades",
}


_COACH_CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "evaluate_move",
            "description": (
                "Evaluate a specific chess move in the current position. "
                "Use this when the student asks 'what if I played X?' or about a move "
                "that is NOT already in the engine line provided."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "move_san": {
                        "type": "string",
                        "description": "The move to evaluate in Standard Algebraic Notation (e.g. 'Nf6', 'e4', 'O-O')",
                    },
                },
                "required": ["move_san"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_alternatives",
            "description": (
                "Get the top engine-recommended alternative moves for the current position. "
                "Use this when the student asks for alternatives, other options, or the best moves."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "num_lines": {
                        "type": "integer",
                        "description": "How many alternative lines to return (1-4). Default 3.",
                    },
                },
                "required": [],
            },
        },
    },
]


async def coach_chat_turn(
    conversation: list[dict],
    fen: str,
    position_context: dict,
    engine_callback,  # async (tool_name: str, args: dict) -> str
) -> str | None:
    """
    One turn of an interactive chess coaching chat with engine tool access.

    position_context keys: move_san, classification, centipawn_loss, engine_pv_san, patterns
    engine_callback: called when the LLM requests a tool — returns a string result.
    The LLM may call tools up to 2 rounds before giving a final answer.
    """
    pv_str = " ".join(position_context.get("engine_pv_san", [])[:4]) or position_context.get("engine_best_move", "")
    patterns_str = ", ".join(
        p["type"].replace("_", " ") for p in position_context.get("patterns", [])[:3]
    ) or "none"

    system = (
        "You are an interactive chess coach. A student is reviewing their game with you.\n\n"
        f"Position context:\n"
        f"- Move played: {position_context.get('move_san', '?')} "
        f"({position_context.get('classification', '?')}, {position_context.get('centipawn_loss', 0):.0f} cp loss)\n"
        f"- Engine best line: {pv_str}\n"
        f"- Detected patterns: {patterns_str}\n\n"
        "You have two tools:\n"
        "- evaluate_move: use when the student asks about a SPECIFIC move not already in the engine line\n"
        "- get_alternatives: use when the student asks for other options or best moves\n\n"
        "Rules: Only reference moves/squares you know from context or from tool results. "
        "Never invent engine lines. Be concise (2-4 sentences per reply)."
    )

    messages = [{"role": "system", "content": system}] + conversation
    is_thinking = _is_thinking_model()

    async def _llm_call(msgs, use_tools: bool):
        kwargs = dict(
            model=settings.ollama_model,
            messages=msgs,
            options={"temperature": 0.3, "num_predict": 300},
        )
        if use_tools:
            kwargs["tools"] = _COACH_CHAT_TOOLS
        if is_thinking:
            kwargs["think"] = False
        return await asyncio.wait_for(_client.chat(**kwargs), timeout=LLM_TIMEOUT_LONG)

    try:
        # First call — LLM may decide to use tools
        resp = await _llm_call(messages, use_tools=True)

        # Agentic loop: execute tool calls and feed results back (max 2 rounds)
        for _ in range(2):
            if not resp.message.tool_calls:
                break

            # Append assistant message with tool_calls
            messages.append(resp.message)

            # Execute each requested tool and append results
            for tc in resp.message.tool_calls:
                tool_result = await engine_callback(
                    tc.function.name,
                    tc.function.arguments or {},
                )
                messages.append({"role": "tool", "content": tool_result})

            # Ask LLM to produce the final answer now that it has tool results
            resp = await _llm_call(messages, use_tools=False)

        return _strip_thinking(resp.message.content.strip())

    except asyncio.TimeoutError:
        print("[llm] coach_chat_turn timed out")
        return None
    except Exception as exc:
        print(f"[llm] coach_chat_turn error: {exc}")
        return None


async def explain_single_tactic(
    pattern_type: str,
    user_move_san: str,
    best_move_san: str,
    engine_pv_san: list[str],
    tactic_explanation: str,
    centipawn_loss: float,
) -> str | None:
    """
    Explain a single tactic position concretely, grounded only in the provided engine data.
    The LLM must not invent moves or squares beyond what is explicitly given.
    """
    pv_str = " ".join(engine_pv_san[:4]) if engine_pv_san else best_move_san
    tactic_context = f" ({tactic_explanation})" if tactic_explanation else ""

    prompt = (
        f"A chess player missed the move {best_move_san} (played {user_move_san} instead, "
        f"{centipawn_loss:.0f} cp loss). "
        f"The engine's best continuation is: {pv_str}.{tactic_context}\n\n"
        f"Pattern: {pattern_type.replace('_', ' ')}.\n\n"
        f"In 2-3 sentences explain:\n"
        f"1. Why {best_move_san} is the right move and what it achieves concretely.\n"
        f"2. A practical visual cue or question to ask yourself to spot this pattern.\n\n"
        f"STRICT RULES: Only reference moves and squares explicitly listed above. "
        f"Do NOT invent any other moves, squares, or pieces. "
        f"Do NOT generalize — explain THIS specific position only."
    )
    return await _call_ollama(prompt, num_predict=250, timeout=LLM_TIMEOUT_LONG)


async def generate_pattern_tip(
    pattern_type: str,
    sample_positions: list[dict],
) -> str | None:
    """
    Generate practical coaching tips for how to spot/avoid a recurring pattern.
    sample_positions: list of {fen, user_move_san, best_move_san, description}
    """
    human_name = PATTERN_TIP_NAMES.get(pattern_type, pattern_type.replace("_", " "))

    pos_text = ""
    for i, p in enumerate(sample_positions[:3], 1):
        pv = p.get("engine_pv_san") or []
        pv_str = " ".join(pv[:4]) if pv else p.get("best_move_san", "?")
        tactic = p.get("tactic_explanation", "")
        pos_text += (
            f"\nExample {i}: {p.get('description', '')}. "
            f"Player played {p.get('user_move_san', '?')}, "
            f"engine best line: {pv_str}."
        )
        if tactic:
            pos_text += f" ({tactic})"

    prompt = (
        f"The student repeatedly struggles with {human_name}. "
        f"Here are {len(sample_positions[:3])} concrete examples from their own games:{pos_text}\n\n"
        "Give 3 practical tips (each 1-2 sentences) on:\n"
        "1. How to spot this type of opportunity/threat BEFORE making the move — reference the engine lines above.\n"
        "2. A mental checklist or visual cue to use at the board.\n"
        "3. The key principle behind why this pattern matters.\n"
        "Be concrete and actionable. No generic advice."
    )

    return await _call_ollama(prompt, num_predict=350, timeout=LLM_TIMEOUT_LONG)


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
    user_answer_text: str = "",
    thinking_errors: list[dict] = [],
) -> str:
    """
    Build a coaching explanation where all chess facts are deterministic (Python-computed)
    and the LLM evaluates the user's reasoning and adds a conceptual note.
    """
    parts = []

    # --- Section 1: Student's suggested move vs game move ---
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

    # --- Section 3: Engine recommendation (all facts, not LLM) ---
    if engine_pv_san:
        parts.append(f"Engine best line — {' '.join(engine_pv_san)}")
    else:
        parts.append(f"Engine best move — {best_move_san}")

    # --- Section 3b: Thinking errors (deterministic) ---
    if thinking_errors:
        for err in thinking_errors:
            parts.append(f"Thinking pattern — {err['description']}")

    # --- Section 4: LLM evaluates the user's written reasoning ---
    # If user wrote reasoning text, the LLM assesses whether their thinking is
    # correct/reveals a misconception, then states the key chess idea.
    # If no text was written, falls back to one-sentence key idea only.
    pv_str = " ".join(engine_pv_san[:5]) if engine_pv_san else best_move_san
    answer_excerpt = (user_answer_text or "").strip()[:300]

    thinking_context = ""
    if thinking_errors:
        err_names = "; ".join(e["description"] for e in thinking_errors[:2])
        thinking_context = f"Thinking issues detected: {err_names}. "

    if answer_excerpt:
        concept_prompt = (
            f"{thinking_context}"
            f"A chess player was asked what they would play. They wrote: \"{answer_excerpt}\". "
            f"They played {move_san} in the game (a {classification}, {centipawn_loss:.0f} cp loss). "
            f"The engine recommends {best_move_san}: {pv_str}. "
            f"In 2-3 short sentences: "
            f"(1) assess whether their reasoning shows correct understanding or reveals a specific misconception or knowledge gap — be direct; "
            f"(2) state what chess idea {best_move_san} embodies. "
            f"Do NOT invent moves. Do NOT mention specific squares beyond those already listed."
        )
        label = "Assessment"
    else:
        concept_prompt = (
            f"{thinking_context}"
            f"A chess player played {move_san} (a {classification}, {centipawn_loss:.0f} cp loss). "
            f"The engine recommends {best_move_san}: {pv_str}. "
            f"In ONE sentence, state what chess idea {best_move_san} embodies "
            f"(e.g. development, piece activity, king safety, initiative, coordination). "
            f"Do NOT invent moves. Do NOT mention specific squares beyond those already listed."
        )
        label = "Key idea"

    # 1 sentence → small token budget, short timeout
    concept = await _call_ollama(concept_prompt, num_predict=120, timeout=LLM_TIMEOUT_SHORT)
    if concept:
        parts.append(f"{label} — {concept}")

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

    hint = await _call_ollama(hint_prompt, num_predict=120, timeout=LLM_TIMEOUT_SHORT)
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


async def explain_annotation(
    move_san: str,
    best_move_san: str,
    centipawn_loss: float,
    classification: str,
    user_annotation: str,
    user_eval_label: str,
    eval_verdict: str,          # deterministic verdict computed by router
    user_candidates: list[str],
    engine_pv_san: list[str],
    patterns: list[dict],
) -> str:
    """
    Build a self-annotation explanation. All chess facts are deterministic;
    LLM adds only one conceptual contrast sentence.
    """
    parts = []

    # --- Section 1: Was user's eval label correct? (deterministic) ---
    parts.append(f"Your position assessment ({user_eval_label}): {eval_verdict}.")

    # --- Section 2: Candidate move quality (deterministic) ---
    if user_candidates:
        candidates_str = ", ".join(c for c in user_candidates if c)
        if candidates_str:
            if best_move_san in user_candidates:
                parts.append(f"Candidates considered ({candidates_str}): the engine's best move was among them.")
            else:
                parts.append(f"Candidates considered ({candidates_str}): the engine's best move ({best_move_san}) was not in your list.")

    # --- Section 3: Engine best line (deterministic) ---
    if engine_pv_san:
        parts.append(f"Engine best line — {' '.join(engine_pv_san)}")
    else:
        parts.append(f"Engine best move — {best_move_san}")

    # --- Section 4: Detected patterns (deterministic) ---
    if patterns:
        pattern_names = ", ".join(p["type"].replace("_", " ") for p in patterns[:3])
        parts.append(f"Pattern(s) detected — {pattern_names}.")

    # --- Section 5: LLM conceptual contrast (one sentence only) ---
    annotation_excerpt = (user_annotation or "")[:200]
    pv_str = " ".join(engine_pv_san[:3]) if engine_pv_san else best_move_san
    concept_prompt = (
        f"A chess player played {move_san} ({classification}, {centipawn_loss:.0f} cp loss) "
        f"and explained: \"{annotation_excerpt}\". "
        f"The engine recommends {best_move_san} with the line: {pv_str}. "
        f"In ONE sentence, contrast the chess idea behind the player's move vs the engine's recommendation. "
        f"Do NOT invent moves or mention specific squares beyond those already listed."
    )
    concept = await _call_ollama(concept_prompt, num_predict=120, timeout=LLM_TIMEOUT_SHORT)
    if concept:
        parts.append(f"Key idea — {concept}")

    return "\n\n".join(parts)


async def generate_review_comment(
    move_san: str,
    classification: str,
    centipawn_loss: float,
    user_annotation: str,
    user_eval_label: str,
    eval_verdict: str,      # "correct" | "slightly off" | "significantly off" | ...
    engine_best_move: str,
    engine_pv_san: list[str],
    best_in_candidates: bool,
    patterns: list[dict],
) -> str:
    """
    Generate a targeted coaching comment for a self-annotated move.
    LLM is skipped for straightforward correct moves to keep review fast.
    Returns a coaching question for wrong thinking or a deeper insight for correct moves.
    """
    annotation_text = (user_annotation or "").strip()[:300]
    pv_str = " ".join(engine_pv_san[:4]) if engine_pv_san else engine_best_move
    patterns_text = ", ".join(p["type"].replace("_", " ") for p in patterns[:2]) if patterns else ""
    is_critical = classification in ("mistake", "blunder")
    eval_correct = eval_verdict in ("correct", "slightly off")

    # Skip LLM for well-annotated moves with correct evaluation — give a short positive note
    if not is_critical and eval_correct and best_in_candidates and annotation_text:
        comment = await _call_ollama(
            f"Chess player handled move {move_san} correctly: assessed position as {user_eval_label} ({eval_verdict}), "
            f"included {engine_best_move} in candidates. They wrote: \"{annotation_text[:200]}\". "
            f"Engine: {engine_best_move}: {pv_str}. "
            f"In 1-2 sentences, confirm what they understood correctly and add one chess principle.",
            num_predict=160, timeout=LLM_TIMEOUT_SHORT,
        )
        return comment or f"Correct evaluation and candidate selection. Engine's {engine_best_move} ({pv_str}) reflects good positional understanding."

    # For critical moves or wrong evaluations, generate targeted coaching
    eval_off = not eval_correct and user_eval_label
    candidates_missed = not best_in_candidates and engine_best_move

    if annotation_text:
        if is_critical and eval_off:
            instruction = (
                "Ask a Socratic question (1-2 sentences) that guides the player to see "
                "why their move failed AND why they misjudged the position. "
                "Point to the specific gap using the engine line."
            )
        elif is_critical:
            instruction = (
                "State the chess principle this position illustrates and explain in 1-2 sentences "
                "what the engine's continuation achieves that the played move missed."
            )
        elif eval_off:
            instruction = (
                "Ask a targeted question (1-2 sentences) about why the position may be "
                "different from what they assessed, using the engine recommendation as a clue."
            )
        elif candidates_missed:
            instruction = (
                "The player's evaluation was correct but they missed the engine's best move. "
                "In 1-2 sentences, ask what other moves they could have considered and why "
                f"{engine_best_move} is stronger."
            )
        else:
            instruction = "Confirm their reasoning in 1-2 sentences and add one deeper chess insight."

        prompt = (
            f"Chess position: {move_san} was played ({classification}, {centipawn_loss:.0f} cp loss). "
            f"Engine best: {engine_best_move}: {pv_str}. "
            f"Player's eval: {user_eval_label} (verdict: {eval_verdict}). "
            f"Player wrote: \"{annotation_text}\". "
            + (f"Patterns: {patterns_text}. " if patterns_text else "")
            + instruction
            + " Do NOT mention squares beyond those listed. Do NOT invent moves."
        )
    else:
        # No annotation — prompt them to think about the position
        prompt = (
            f"Chess: {move_san} was played ({classification}, {centipawn_loss:.0f} cp loss) without explanation. "
            f"Engine best: {engine_best_move}: {pv_str}. "
            + (f"Pattern: {patterns_text}. " if patterns_text else "")
            + "Ask one concise Socratic question to help the player understand what they missed. "
            "Do NOT mention squares beyond those listed."
        )

    comment = await _call_ollama(prompt, num_predict=200, timeout=LLM_TIMEOUT_SHORT)
    if comment:
        return comment

    # Deterministic fallback
    if is_critical:
        return f"{move_san} was a {classification} ({centipawn_loss:.0f} cp loss). Engine recommends {engine_best_move}: {pv_str}."
    elif eval_off:
        return f"Your assessment ({user_eval_label}) was {eval_verdict}. Consider how {engine_best_move} changes the picture: {pv_str}."
    return f"Engine's best here was {engine_best_move}: {pv_str}."


async def generate_review_reply(
    move_san: str,
    engine_best_move: str,
    engine_pv_san: list[str],
    coach_comment: str,
    user_response: str,
) -> str:
    """
    Generate a coach reply to the player's response during coach review.
    Acknowledges correct parts, corrects remaining gaps, closes with key principle.
    """
    pv_str = " ".join(engine_pv_san[:4]) if engine_pv_san else engine_best_move
    prompt = (
        f"Chess coach commented on move {move_san} (engine best: {engine_best_move}: {pv_str}). "
        f"Coach said: \"{coach_comment[:250]}\". "
        f"Player replied: \"{user_response[:300]}\". "
        f"Write a coaching reply in 2-3 sentences: "
        f"(1) acknowledge what is correct in their reply; "
        f"(2) correct any remaining gap or confirm full understanding; "
        f"(3) close with the key chess principle from this position. "
        f"Do NOT invent moves or squares beyond those already listed."
    )
    reply = await _call_ollama(prompt, num_predict=200, timeout=LLM_TIMEOUT_LONG)
    if reply:
        return reply
    pv_short = " ".join(engine_pv_san[:3]) if engine_pv_san else engine_best_move
    return (
        f"Good thinking. The key insight is that {engine_best_move} ({pv_short}) "
        "addresses the critical factors in the position."
    )


async def generate_session_summary(
    user_color: str,
    opponent: str,
    result: str,
    total_mistakes: int,
    total_blunders: int,
    top_pattern_types: list[str],
    worst_move: dict | None,  # {move_san, centipawn_loss, classification}
) -> str:
    """
    Generate a short coaching summary shown at the top of the session.
    Describes what went wrong in the game and sets focus for the review.
    Falls back to a deterministic string if Ollama is unavailable.
    """
    patterns_text = (
        ", ".join(t.replace("_", " ") for t in top_pattern_types[:3])
        if top_pattern_types else "general errors"
    )
    worst_text = (
        f"The worst error was {worst_move['move_san']} "
        f"({worst_move['centipawn_loss']:.0f} cp loss, {worst_move['classification']})."
        if worst_move else ""
    )

    prompt = (
        f"A chess player playing as {user_color} against {opponent}. Result: {result}. "
        f"They made {total_mistakes} mistake(s) and {total_blunders} blunder(s). "
        f"Most frequent issues: {patterns_text}. "
        f"{worst_text} "
        f"Write exactly 2 sentences: "
        f"(1) what the main problem was in this game; "
        f"(2) what the player should focus on during this review. "
        f"Be specific and direct. Do not mention specific squares or invent moves."
    )

    result_text = await _call_ollama(prompt, num_predict=200, timeout=LLM_TIMEOUT_LONG)
    if result_text:
        return result_text

    # Deterministic fallback
    error_summary = f"{total_mistakes} mistake(s) and {total_blunders} blunder(s)"
    return (
        f"In this game as {user_color}, you made {error_summary}. "
        f"Main themes: {patterns_text}. "
        f"Let's work through each critical position."
    )


async def analyze_questionnaire(
    game_result: str,              # "win" / "loss" / "draw" / "unknown"
    result_reason: str,
    key_moment: str,
    takeaway: str,
    would_do_differently: str,
    plan_adherence: str,           # "always"/"mostly"/"reacting"/"no_plan"
    time_pressure: str,            # "not_at_all"/"slightly"/"significantly"
    opening_prep: str,             # "solid"/"ok"/"poor"/"winging_it"
    worst_moves: list[dict],       # [{move_san, centipawn_loss, classification}]
    pattern_types: list[str],      # unique pattern type strings
) -> str | None:
    """
    Analyze the player's post-game questionnaire answers in light of actual engine data.
    Returns 3-4 sentences of targeted coaching feedback, or a deterministic fallback.
    """
    # Build worst moves text
    if worst_moves:
        moves_text = ", ".join(
            f"{m['move_san']} ({m['centipawn_loss']:.0f}cp, {m['classification']})"
            for m in worst_moves[:3]
        )
    else:
        moves_text = "no significant errors detected"

    patterns_str = ", ".join(t.replace("_", " ") for t in pattern_types[:4]) or "none detected"

    # Build prompt, omitting blank optional fields
    lines = [
        f"A chess player {game_result} a game and reflected on it.",
        "",
        "Their self-assessment:",
        f'- Why they {game_result}: "{result_reason}"',
    ]
    if key_moment.strip():
        lines.append(f'- Key turning point: "{key_moment}"')
    lines.append(f'- Main takeaway: "{takeaway}"')
    if would_do_differently.strip():
        lines.append(f'- Would do differently: "{would_do_differently}"')
    lines += [
        f"- Plan adherence: {plan_adherence}",
        f"- Time pressure: {time_pressure}",
        f"- Opening prep: {opening_prep}",
        "",
        "Objective engine data:",
        f"- Their 3 worst moves: {moves_text}",
        f"- Recurring patterns: {patterns_str}",
        "",
        "As a chess coach, write 3-4 sentences:",
        "1. Validate or gently challenge their stated reason — compare to the engine's worst moves",
        "2. Reinforce or sharpen their takeaway using the concrete pattern data",
        "3. Identify any gap or blind spot in their self-assessment",
        "4. End with ONE specific question to deepen their reflection",
        "",
        "Under 120 words. Be direct, specific, encouraging.",
    ]
    prompt = "\n".join(lines)

    result = await _call_ollama(prompt, num_predict=250, timeout=LLM_TIMEOUT_LONG)
    if result:
        return result

    # Deterministic fallback
    worst = worst_moves[0] if worst_moves else None
    parts = ["Your self-assessment is a useful start."]
    if worst:
        parts.append(
            f"The engine flagged {worst['move_san']} ({worst['centipawn_loss']:.0f} cp) "
            f"as the biggest error."
        )
    parts.append(f"Recurring patterns: {patterns_str}.")
    if takeaway:
        parts.append(f"Takeaway noted: \"{takeaway[:80]}\"")
    return " ".join(parts)


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

    result = await _call_ollama(prompt, num_predict=400, timeout=LLM_TIMEOUT_LONG)
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
