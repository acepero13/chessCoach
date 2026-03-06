"""
Tactical pattern detection from engine move evaluations.

Patterns detected:
- missed_fork: The engine's best move was a fork
- missed_pin: The engine's best move created a pin
- hanging_piece_missed: Opponent had a hanging piece, user didn't capture it
- missed_checkmate: The engine's best move was checkmate
- blunder_hanging: User's move left one of their own pieces hanging
- tactical_shot_found: User found a correct sacrifice/tactic (positive)

Design: patterns are derived from the ENGINE's best move, not from scanning
all legal moves. This prevents false positives (e.g., detecting a "missed fork"
just because some legal move happens to attack two pieces).

At most ONE missed-tactic pattern is emitted per move (priority: checkmate >
fork > pin > hanging_piece). This prevents a single blunder from inflating the
missed-tactics count by 3–4×.
"""
import chess
from dataclasses import dataclass
from app.engine.stockfish import MoveEval

# Piece values for capture-profitability checks (centipawn-like units)
PIECE_VALUES = {
    chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
    chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100,
}


@dataclass
class Pattern:
    type: str
    move_number: int
    color: str
    severity: float     # 0–1 normalized severity
    fen: str
    description: str
    move_san: str


# ---------------------------------------------------------------------------
# Helpers that evaluate a SPECIFIC move, not all legal moves
# ---------------------------------------------------------------------------

def _is_hanging(board: chess.Board, square: chess.Square) -> bool:
    """
    Return True if the piece on `square` can be captured profitably by the
    side to move (board.turn).

    Uses generate_legal_moves() instead of board.attackers() so that pinned
    attackers are correctly excluded — a pinned piece cannot legally capture
    even if it geometrically attacks the square.

    Profitable = cheapest legal attacker is worth less than the target,
    or the target is completely undefended (any capture wins material).
    """
    piece = board.piece_at(square)
    if piece is None:
        return False

    piece_val = PIECE_VALUES.get(piece.piece_type, 0)
    if piece_val == 0:
        return False

    # Find the minimum-value LEGAL capture of this square by board.turn.
    # generate_legal_moves respects pins, checks, and other constraints.
    min_cap_val = float('inf')
    for move in board.generate_legal_moves(to_mask=chess.BB_SQUARES[square]):
        attacker = board.piece_at(move.from_square)
        if attacker is not None:
            cap_val = PIECE_VALUES.get(attacker.piece_type, 100)
            if cap_val < min_cap_val:
                min_cap_val = cap_val

    if min_cap_val == float('inf'):
        return False  # no legal capture exists (e.g. all attackers are pinned)

    defenders = board.attackers(piece.color, square)
    if not defenders:
        return True  # completely undefended — any legal capture wins

    return min_cap_val < piece_val


def _move_creates_fork(board: chess.Board, move: chess.Move) -> bool:
    """
    Return True if `move` creates a genuine fork: after the move, the landing
    piece attacks 2 or more opponent valuable pieces that can be captured
    profitably (target worth >= attacker, or target is hanging).
    Merely attacking defended pieces of equal or lesser value is not a fork.
    """
    color = board.turn
    test = board.copy()
    test.push(move)
    landing = move.to_square
    landing_piece = test.piece_at(landing)
    if landing_piece is None:
        return False
    landing_val = PIECE_VALUES.get(landing_piece.piece_type, 0)

    profitable_attacks = 0
    for sq in chess.SQUARES:
        piece = test.piece_at(sq)
        if (
            piece
            and piece.color != color
            and piece.piece_type in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT)
            and bool(test.attacks(landing) & chess.BB_SQUARES[sq])
        ):
            target_val = PIECE_VALUES.get(piece.piece_type, 0)
            # Count only if capture would be profitable OR target is hanging
            if target_val >= landing_val or _is_hanging(test, sq):
                profitable_attacks += 1

    return profitable_attacks >= 2


def _move_creates_pin(board: chess.Board, move: chess.Move) -> bool:
    """
    Return True if `move` creates a meaningful pin: after the move, an opponent
    piece of at least knight value is absolutely pinned to its king.
    Pinned pawns are ignored because pinning a pawn is common and rarely decisive.
    python-chess is_pinned() checks absolute pins (to king) only.
    """
    color = board.turn
    test = board.copy()
    test.push(move)
    for sq in chess.SQUARES:
        piece = test.piece_at(sq)
        if (
            piece
            and piece.color != color
            and piece.piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
            and test.is_pinned(not color, sq)
        ):
            return True
    return False


def _count_hanging_pieces(board: chess.Board, color: chess.Color) -> int:
    """Count opponent's hanging pieces (from `color`'s perspective)."""
    count = 0
    opponent = not color
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.color == opponent and _is_hanging(board, sq):
            count += 1
    return count


# ---------------------------------------------------------------------------
# Main detector
# ---------------------------------------------------------------------------

def detect_tactical_patterns(move_evals: list[MoveEval]) -> list[dict]:
    """
    Detect tactical patterns from a sequence of move evaluations.
    Returns a list of pattern dicts suitable for JSON storage.
    """
    patterns: list[dict] = []

    for ev in move_evals:
        board = chess.Board(ev.fen)

        # -------------------------------------------------------------------
        # Positive pattern: correct sacrifice / tactical shot
        # -------------------------------------------------------------------
        if ev.classification in ("best", "good") and ev.is_capture:
            target_sq = chess.Move.from_uci(ev.move_uci).to_square
            if not _is_hanging(board, target_sq) and ev.eval_after > ev.eval_before + 30:
                patterns.append({
                    "type": "tactical_shot_found",
                    "move_number": ev.move_number,
                    "color": ev.color,
                    "severity": 0.0,
                    "fen": ev.fen,
                    "description": f"Correct sacrifice/tactic found: {ev.move_san}",
                    "move_san": ev.move_san,
                })

        # -------------------------------------------------------------------
        # Missed-tactic patterns — emit at most ONE per move (priority order)
        # -------------------------------------------------------------------
        if ev.classification not in ("mistake", "blunder"):
            continue

        try:
            best_move = chess.Move.from_uci(ev.best_move_uci)
        except Exception:
            continue  # Skip if best move uci is missing/invalid

        severity = round(min(1.0, ev.centipawn_loss / 300), 3)

        # 1. Missed checkmate (highest priority)
        try:
            test_board = board.copy()
            test_board.push(best_move)
            if test_board.is_checkmate():
                patterns.append({
                    "type": "missed_checkmate",
                    "move_number": ev.move_number,
                    "color": ev.color,
                    "severity": round(min(1.0, ev.centipawn_loss / 300), 3),
                    "fen": ev.fen,
                    "description": f"Missed checkmate with {ev.best_move_san}, played {ev.move_san}",
                    "move_san": ev.move_san,
                })
                continue  # Only one pattern per move
        except Exception:
            pass

        # 2. Missed fork (engine's best move was a fork)
        if ev.centipawn_loss > 80 and _move_creates_fork(board, best_move):
            patterns.append({
                "type": "missed_fork",
                "move_number": ev.move_number,
                "color": ev.color,
                "severity": severity,
                "fen": ev.fen,
                "description": f"Missed fork with {ev.best_move_san}, played {ev.move_san} instead",
                "move_san": ev.move_san,
            })
            continue

        # 3. Missed pin (engine's best move created a pin)
        if ev.centipawn_loss > 60 and _move_creates_pin(board, best_move):
            patterns.append({
                "type": "missed_pin",
                "move_number": ev.move_number,
                "color": ev.color,
                "severity": severity,
                "fen": ev.fen,
                "description": f"Missed pin with {ev.best_move_san}, played {ev.move_san} instead",
                "move_san": ev.move_san,
            })
            continue

        # 4. Hanging piece missed — only when the engine's best move IS the capture
        #    of a piece that is genuinely hanging (undefended/underdefended).
        #    Do NOT fire just because some hanging piece exists elsewhere on the board;
        #    the engine must confirm that capturing it was the right choice.
        #    Only flag minor pieces and above (value >= 3); missing a hanging pawn is
        #    common and rarely decisive enough to report as a distinct motif.
        if ev.centipawn_loss > 100:
            user_move = chess.Move.from_uci(ev.move_uci)
            target_piece = board.piece_at(best_move.to_square)
            target_val = PIECE_VALUES.get(target_piece.piece_type, 0) if target_piece else 0
            if (
                board.is_capture(best_move)           # engine's best IS a capture
                and not board.is_capture(user_move)   # user did not capture
                and target_val >= 3                   # only minor pieces and above
                and _is_hanging(board, best_move.to_square)  # captured piece is hanging
            ):
                patterns.append({
                    "type": "hanging_piece_missed",
                    "move_number": ev.move_number,
                    "color": ev.color,
                    "severity": round(min(1.0, ev.centipawn_loss / 250), 3),
                    "fen": ev.fen,
                    "description": (
                        f"Missed capturing the hanging piece with {ev.best_move_san}, "
                        f"played {ev.move_san} instead"
                    ),
                    "move_san": ev.move_san,
                })
                continue

        # 5. Positional error fallback — no specific tactic was missed, but the move
        #    is still a significant mistake (centipawn loss without tactical explanation).
        #    Only emitted when none of the above patterns matched (all above used `continue`).
        if ev.centipawn_loss > 60:
            patterns.append({
                "type": "positional_error",
                "move_number": ev.move_number,
                "color": ev.color,
                "severity": round(min(1.0, ev.centipawn_loss / 300), 3),
                "fen": ev.fen,
                "description": (
                    f"{ev.move_san} was a positional error — "
                    f"engine preferred {ev.best_move_san} ({ev.centipawn_loss:.0f} cp better)"
                ),
                "move_san": ev.move_san,
            })

        # 6. Blunder that hangs own piece (separate from missed-tactic, can co-exist)
        if ev.classification == "blunder" and ev.centipawn_loss > 150:
            board_after = board.copy()
            board_after.push(chess.Move.from_uci(ev.move_uci))
            if _count_hanging_pieces(board_after, not board.turn) > 0:
                patterns.append({
                    "type": "blunder_hanging",
                    "move_number": ev.move_number,
                    "color": ev.color,
                    "severity": round(min(1.0, ev.centipawn_loss / 500), 3),
                    "fen": ev.fen,
                    "description": f"Blunder that left own pieces hanging after {ev.move_san}",
                    "move_san": ev.move_san,
                })

    return patterns
