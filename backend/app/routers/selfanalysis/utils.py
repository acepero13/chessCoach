"""
Pure helpers — no FastAPI, no DB, no LLM dependencies.
"""
import chess
import re
from app.patterns.tactical_detectors import _is_hanging

LABEL_MAP = {"winning": 3, "better": 1, "equal": 0, "worse": -1, "losing": -3}


def _engine_bucket(cp: float) -> int:
    if cp > 200:
        return 3
    if cp > 50:
        return 1
    if cp > -50:
        return 0
    if cp > -200:
        return -1
    return -3


def _eval_verdict(user_label: str, engine_eval_before: float) -> str:
    """Deterministic verdict: was the user's position evaluation correct?"""
    if user_label not in LABEL_MAP:
        return "assessment not recorded"
    user_num = LABEL_MAP[user_label]
    engine_num = _engine_bucket(engine_eval_before)
    diff = abs(user_num - engine_num)
    if diff == 0:
        return "correct"
    if diff == 1:
        return "slightly off"
    return "significantly off"


def _strip_html(text: str) -> str:
    """Strip HTML tags from user annotation before passing to LLM."""
    if not text:
        return text
    return re.sub(r'<[^>]+>', ' ', text).strip()


def _pv_uci_to_san(fen: str, pv_uci: list[str]) -> list[str]:
    """Convert a UCI principal variation to SAN notation from the given FEN."""
    board = chess.Board(fen)
    san_moves = []
    for uci in pv_uci:
        try:
            move = chess.Move.from_uci(uci)
            san_moves.append(board.san(move))
            board.push(move)
        except Exception:
            break
    return san_moves


def _validated_patterns(
    all_patterns: list[dict],
    move_number: int,
    fen: str,
    best_move_uci: str,
) -> list[dict]:
    """Filter stale false positives from stored patterns."""
    result = []
    for p in all_patterns:
        if p.get("move_number") != move_number:
            continue
        if p.get("type") == "hanging_piece_missed" and best_move_uci:
            try:
                board = chess.Board(fen)
                bm = chess.Move.from_uci(best_move_uci)
                if not (board.is_capture(bm) and _is_hanging(board, bm.to_square)):
                    continue
            except Exception:
                pass
        result.append(p)
    return result


def _fen_after_move(fen_before: str, move_uci: str) -> str:
    """Return FEN after playing a move from a FEN position."""
    board = chess.Board(fen_before)
    move = chess.Move.from_uci(move_uci)
    board.push(move)
    return board.fen()


def _build_all_game_moves(evals: list, user_color: str) -> tuple[list, list]:
    """
    Build the full list of game moves (both colors) with is_user_move flag.
    Returns (all_game_moves, user_eval_indices).
    """
    all_game_moves = []
    user_eval_indices = []
    for i, e in enumerate(evals):
        is_user = e.get("color") == user_color
        classification = e.get("classification", "good")
        priority = "high" if is_user and classification in ("mistake", "blunder") else "normal"
        fen_after = _fen_after_move(e["fen"], e["move_uci"]) if e.get("move_uci") else e["fen"]
        all_game_moves.append({
            "move_index": i,
            "move_number": e.get("move_number", 0),
            "fen_before": e["fen"],
            "fen_after": fen_after,
            "move_san": e.get("move_san", ""),
            "color": e.get("color", ""),
            "is_user_move": is_user,
            "classification": classification,
            "centipawn_loss": e.get("centipawn_loss", 0.0),
            "priority": priority,
            # Engine data from batch analysis — available for every move
            "best_move_uci": e.get("best_move_uci", ""),
            "best_move_san": e.get("best_move_san", ""),
            "eval_before": e.get("eval_before", 0.0),
            "eval_after": e.get("eval_after", 0.0),
        })
        if is_user:
            user_eval_indices.append(i)
    return all_game_moves, user_eval_indices
