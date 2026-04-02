"""
Tactical pattern detection from engine move evaluations.

Patterns detected:
- missed_fork          : engine's best move was a fork (immediate or via PV)
- missed_pin           : engine's best move pinned a piece to king OR queen
- missed_discovered_attack : engine's best move uncovered a sliding-piece attack
- hanging_piece_missed : opponent had a hanging piece, user didn't capture it
- missed_checkmate     : engine's best move was checkmate
- blunder_hanging      : user's move left one of their own pieces hanging
- tactical_shot_found  : user found a correct sacrifice/tactic (positive)

Design:
- Patterns are derived from the ENGINE's best move (pv[0]), not by scanning all
  legal moves. This prevents false positives.
- PV walking: when pv[0] itself contains a sacrifice/quiet move, tactics are
  searched up to 4 half-moves deep in the PV (catching sacrifice → fork, etc.).
- Pin detection covers both absolute pins to king AND practical pins to queen.
- At most ONE missed-tactic pattern per move (priority: checkmate > fork > pin
  > discovered attack > PV tactic > hanging piece). This prevents a single blunder
  from inflating missed-tactics counts by 3-4×.
"""
import chess
from dataclasses import dataclass
from app.engine.stockfish import MoveEval

PIECE_VALUES = {
    chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
    chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100,
}

_VALUABLE = frozenset({chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT})


@dataclass
class Pattern:
    type: str
    move_number: int
    color: str
    severity: float
    fen: str
    description: str
    move_san: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_hanging(board: chess.Board, square: chess.Square) -> bool:
    """
    Return True if the piece on `square` can be captured profitably by the
    side to move. Uses generate_legal_moves() so pinned attackers are excluded.
    """
    piece = board.piece_at(square)
    if piece is None:
        return False
    piece_val = PIECE_VALUES.get(piece.piece_type, 0)
    if piece_val == 0:
        return False

    min_cap_val = float('inf')
    for move in board.generate_legal_moves(to_mask=chess.BB_SQUARES[square]):
        attacker = board.piece_at(move.from_square)
        if attacker:
            cap_val = PIECE_VALUES.get(attacker.piece_type, 100)
            if cap_val < min_cap_val:
                min_cap_val = cap_val

    if min_cap_val == float('inf'):
        return False

    defenders = board.attackers(piece.color, square)
    if not defenders:
        return True

    return min_cap_val < piece_val


def _move_creates_fork(board: chess.Board, move: chess.Move) -> bool:
    """
    After `move`, the landing piece attacks 2+ opponent valuable pieces where
    capturing would be profitable (target worth >= attacker, or target is hanging).
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
            and piece.piece_type in _VALUABLE
            and bool(test.attacks(landing) & chess.BB_SQUARES[sq])
        ):
            target_val = PIECE_VALUES.get(piece.piece_type, 0)
            if target_val >= landing_val or _is_hanging(test, sq):
                profitable_attacks += 1

    return profitable_attacks >= 2


def _move_creates_pin(board: chess.Board, move: chess.Move) -> bool:
    """
    Return True if `move` creates a meaningful pin:
      (a) Absolute pin to king — opponent piece of at least knight value is
          absolutely pinned via python-chess is_pinned().
      (b) Practical pin to queen — our slider aligns with an opponent piece
          and the opponent queen on the same ray, with nothing else in between.
    """
    color = board.turn
    test = board.copy()
    test.push(move)
    opponent = not color

    # (a) Absolute pin to king
    for sq in chess.SQUARES:
        piece = test.piece_at(sq)
        if (
            piece
            and piece.color == opponent
            and piece.piece_type in _VALUABLE
            and test.is_pinned(opponent, sq)
        ):
            return True

    # (b) Practical pin to queen — ray tracing
    opponent_queens = test.pieces(chess.QUEEN, opponent)
    if not opponent_queens:
        return False

    for piece_type in (chess.BISHOP, chess.ROOK, chess.QUEEN):
        for slider_sq in test.pieces(piece_type, color):
            for queen_sq in opponent_queens:  # SquareSet is directly iterable
                between = chess.between(slider_sq, queen_sq)  # int bitboard
                if not between:
                    continue  # not aligned (different rank/file/diagonal)

                # Verify the slider can move on this ray direction
                r1, f1 = chess.square_rank(slider_sq), chess.square_file(slider_sq)
                r2, f2 = chess.square_rank(queen_sq),  chess.square_file(queen_sq)
                dr, df = r2 - r1, f2 - f1
                is_rankfile = dr == 0 or df == 0
                is_diagonal = dr != 0 and df != 0 and abs(dr) == abs(df)
                if piece_type == chess.ROOK   and not is_rankfile: continue
                if piece_type == chess.BISHOP and not is_diagonal:  continue

                # Exactly one piece on the ray — must be a valuable opponent piece
                squares_between = list(chess.scan_forward(between))
                pieces_on_ray = [(sq, test.piece_at(sq)) for sq in squares_between if test.piece_at(sq)]
                if len(pieces_on_ray) != 1:
                    continue
                sq, pinned = pieces_on_ray[0]
                if pinned.color == opponent and pinned.piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK):
                    return True

    return False


def _move_creates_discovered_attack(board: chess.Board, move: chess.Move) -> bool:
    """
    Return True if `move` uncovers an attack from one of our sliding pieces
    (bishop, rook, queen) onto a valuable opponent piece.

    A discovered attack occurs when a piece steps off a ray, allowing the
    slider behind it to attack a target it couldn't reach before.
    """
    color = board.turn
    test = board.copy()
    test.push(move)

    for piece_type in (chess.BISHOP, chess.ROOK, chess.QUEEN):
        for slider_sq in board.pieces(piece_type, color):
            if slider_sq == move.from_square:
                continue  # the moved piece itself — not a discovered attack

            # Attacks before and after the move for this slider
            attacks_before = board.attacks(slider_sq)
            attacks_after  = test.attacks(slider_sq)
            # attacks() returns SquareSet — XOR to find newly attacked squares
            newly_attacked = attacks_after - attacks_before  # SquareSet difference

            for sq in newly_attacked:
                piece = test.piece_at(sq)
                if piece and piece.color != color and piece.piece_type in _VALUABLE:
                    return True

    return False


def _detect_in_pv(board: chess.Board, pv_uci: list[str]) -> str | None:
    """
    Walk the PV up to 4 half-moves deep, checking for tactical motifs on our
    follow-up moves (indices 2 and 4, i.e., after the opponent responds).

    pv[0] = our best move (already checked directly — skip here)
    pv[1] = opponent's expected reply
    pv[2] = our 2nd move in the sequence  ← check here (sacrifice → fork)
    pv[3] = opponent's 2nd reply
    pv[4] = our 3rd move                  ← check here if needed

    Returns the first motif type found, or None.
    """
    if len(pv_uci) < 3:
        return None

    b = board.copy()
    for i, uci in enumerate(pv_uci[:5]):
        try:
            move = chess.Move.from_uci(uci)
        except Exception:
            break

        # Only check OUR follow-up moves (i=2, i=4) — skip pv[0] (already done)
        # and skip opponent moves (i=1, i=3)
        if i in (2, 4):
            if _move_creates_fork(b, move):
                return "missed_fork"
            if _move_creates_pin(b, move):
                return "missed_pin"
            if _move_creates_discovered_attack(b, move):
                return "missed_discovered_attack"

        try:
            b.push(move)
        except Exception:
            break

    return None


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
        # Positive: correct sacrifice / tactical shot
        # -------------------------------------------------------------------
        if ev.classification in ("best", "good") and ev.is_capture:
            target_sq = chess.Move.from_uci(ev.move_uci).to_square
            if not _is_hanging(board, target_sq) and ev.eval_after > ev.eval_before + 30:
                patterns.append({
                    "type":        "tactical_shot_found",
                    "move_number": ev.move_number,
                    "color":       ev.color,
                    "severity":    0.0,
                    "fen":         ev.fen,
                    "description": f"Correct sacrifice/tactic found: {ev.move_san}",
                    "move_san":    ev.move_san,
                })

        # -------------------------------------------------------------------
        # Missed-tactic patterns — at most ONE per move
        # -------------------------------------------------------------------
        if ev.classification not in ("mistake", "blunder"):
            continue

        try:
            best_move = chess.Move.from_uci(ev.best_move_uci)
        except Exception:
            continue

        severity = round(min(1.0, ev.centipawn_loss / 300), 3)

        # 1. Missed checkmate
        try:
            test_board = board.copy()
            test_board.push(best_move)
            if test_board.is_checkmate():
                patterns.append({
                    "type":        "missed_checkmate",
                    "move_number": ev.move_number,
                    "color":       ev.color,
                    "severity":    severity,
                    "fen":         ev.fen,
                    "description": f"Missed checkmate with {ev.best_move_san}, played {ev.move_san}",
                    "move_san":    ev.move_san,
                })
                continue
        except Exception:
            pass

        # 2. Missed fork (immediate — pv[0])
        if ev.centipawn_loss > 80 and _move_creates_fork(board, best_move):
            patterns.append({
                "type":        "missed_fork",
                "move_number": ev.move_number,
                "color":       ev.color,
                "severity":    severity,
                "fen":         ev.fen,
                "description": f"Missed fork with {ev.best_move_san}, played {ev.move_san} instead",
                "move_san":    ev.move_san,
            })
            continue

        # 3. Missed pin — king or queen (immediate — pv[0])
        if ev.centipawn_loss > 60 and _move_creates_pin(board, best_move):
            patterns.append({
                "type":        "missed_pin",
                "move_number": ev.move_number,
                "color":       ev.color,
                "severity":    severity,
                "fen":         ev.fen,
                "description": f"Missed pin with {ev.best_move_san}, played {ev.move_san} instead",
                "move_san":    ev.move_san,
            })
            continue

        # 4. Missed discovered attack (immediate — pv[0])
        if ev.centipawn_loss > 60 and _move_creates_discovered_attack(board, best_move):
            patterns.append({
                "type":        "missed_discovered_attack",
                "move_number": ev.move_number,
                "color":       ev.color,
                "severity":    severity,
                "fen":         ev.fen,
                "description": f"Missed discovered attack with {ev.best_move_san}, played {ev.move_san} instead",
                "move_san":    ev.move_san,
            })
            continue

        # 5. PV-based multi-move tactic (sacrifice → fork/pin/discovered attack)
        pv_uci = ev.pv_uci or []
        if ev.centipawn_loss > 80 and len(pv_uci) >= 3:
            pv_motif = _detect_in_pv(board, pv_uci)
            if pv_motif:
                patterns.append({
                    "type":        pv_motif,
                    "move_number": ev.move_number,
                    "color":       ev.color,
                    "severity":    severity,
                    "fen":         ev.fen,
                    "description": (
                        f"Multi-move {pv_motif.replace('_', ' ')} missed — "
                        f"starts with {ev.best_move_san}, played {ev.move_san} instead"
                    ),
                    "move_san":    ev.move_san,
                })
                continue

        # 6. Hanging piece missed (engine's best IS the capture of a hanging piece)
        if ev.centipawn_loss > 100:
            user_move   = chess.Move.from_uci(ev.move_uci)
            target_piece = board.piece_at(best_move.to_square)
            target_val   = PIECE_VALUES.get(target_piece.piece_type, 0) if target_piece else 0
            if (
                board.is_capture(best_move)
                and not board.is_capture(user_move)
                and target_val >= 3
                and _is_hanging(board, best_move.to_square)
            ):
                patterns.append({
                    "type":        "hanging_piece_missed",
                    "move_number": ev.move_number,
                    "color":       ev.color,
                    "severity":    round(min(1.0, ev.centipawn_loss / 250), 3),
                    "fen":         ev.fen,
                    "description": (
                        f"Missed capturing the hanging piece with {ev.best_move_san}, "
                        f"played {ev.move_san} instead"
                    ),
                    "move_san":    ev.move_san,
                })
                continue

        # 7. Positional error fallback
        if ev.centipawn_loss > 60:
            patterns.append({
                "type":        "positional_error",
                "move_number": ev.move_number,
                "color":       ev.color,
                "severity":    round(min(1.0, ev.centipawn_loss / 300), 3),
                "fen":         ev.fen,
                "description": (
                    f"{ev.move_san} was a positional error — "
                    f"engine preferred {ev.best_move_san} ({ev.centipawn_loss:.0f} cp better)"
                ),
                "move_san":    ev.move_san,
            })

        # 8. Blunder that hangs own piece (can co-exist with #7)
        if ev.classification == "blunder" and ev.centipawn_loss > 150:
            board_after = board.copy()
            board_after.push(chess.Move.from_uci(ev.move_uci))
            if _count_hanging_pieces(board_after, not board.turn) > 0:
                patterns.append({
                    "type":        "blunder_hanging",
                    "move_number": ev.move_number,
                    "color":       ev.color,
                    "severity":    round(min(1.0, ev.centipawn_loss / 500), 3),
                    "fen":         ev.fen,
                    "description": f"Blunder that left own pieces hanging after {ev.move_san}",
                    "move_san":    ev.move_san,
                })

    return patterns
