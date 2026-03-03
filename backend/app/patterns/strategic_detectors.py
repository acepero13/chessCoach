"""
Strategic pattern detection: pawn structure, piece activity, positional drift.
"""
import chess
from app.engine.stockfish import MoveEval


def _count_doubled_pawns(board: chess.Board, color: chess.Color) -> int:
    """Count doubled pawns for the given color."""
    file_counts = [0] * 8
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.piece_type == chess.PAWN and piece.color == color:
            file_counts[chess.square_file(sq)] += 1
    return sum(c - 1 for c in file_counts if c > 1)


def _count_isolated_pawns(board: chess.Board, color: chess.Color) -> int:
    """Count isolated pawns for the given color."""
    files_with_pawns = set()
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.piece_type == chess.PAWN and piece.color == color:
            files_with_pawns.add(chess.square_file(sq))

    isolated = 0
    for f in files_with_pawns:
        if (f - 1) not in files_with_pawns and (f + 1) not in files_with_pawns:
            isolated += 1
    return isolated


def _has_weak_squares(board: chess.Board, color: chess.Color) -> bool:
    """
    Detect outposts: squares in opponent's half that can't be attacked by enemy pawns.
    A weak square is a square in the opponent's camp not defended by pawns.
    """
    opponent = not color
    # Collect squares that can no longer be controlled by opponent's pawns
    weak_count = 0
    rank_range = range(4, 8) if color == chess.WHITE else range(0, 4)
    for rank in rank_range:
        for file in range(8):
            sq = chess.square(file, rank)
            if board.piece_at(sq) is not None:
                continue
            # Is this square attacked by the color's pieces?
            if board.is_attacked_by(color, sq):
                # Can opponent's pawns ever attack it?
                can_be_defended_by_pawn = False
                for adj_file in [file - 1, file + 1]:
                    if 0 <= adj_file <= 7:
                        pawn_rank = rank - 1 if opponent == chess.WHITE else rank + 1
                        if 0 <= pawn_rank <= 7:
                            adj_sq = chess.square(adj_file, pawn_rank)
                            piece = board.piece_at(adj_sq)
                            if piece and piece.piece_type == chess.PAWN and piece.color == opponent:
                                can_be_defended_by_pawn = True
                                break
                if not can_be_defended_by_pawn:
                    weak_count += 1
    return weak_count >= 2


def _eval_drift(move_evals: list[MoveEval], window: int = 8) -> list[tuple[int, float]]:
    """
    Identify spans of moves where eval slowly drifted against user without a single blunder.
    Returns list of (start_move_index, total_drift_cp).
    Uses non-overlapping windows to avoid counting the same drift multiple times.
    """
    drifts = []
    if len(move_evals) < window:
        return drifts

    i = 0
    while i <= len(move_evals) - window:
        span = move_evals[i:i + window]
        # Only consider spans with no blunders
        if any(e.classification == "blunder" for e in span):
            i += 1
            continue
        color = span[0].color
        same_color = [e for e in span if e.color == color]
        if len(same_color) < 4:
            i += 1
            continue
        drift = same_color[0].eval_before - same_color[-1].eval_after
        if drift > 150:  # 1.5+ pawn drift without blunders = strategic failure (100cp was too sensitive)
            drifts.append((i, round(drift, 1)))
            i += window  # skip ahead to avoid re-counting the same drift
        else:
            i += 1
    return drifts


def _pawn_count(board: chess.Board) -> int:
    """Total pawns on the board (both colors)."""
    return bin(int(board.pawns)).count('1')


def _is_open_position(board: chess.Board) -> bool:
    """
    Heuristic: fewer than 10 total pawns = relatively open position.
    Bishops thrive in open positions; knights in closed ones.
    """
    return _pawn_count(board) < 10


def detect_strategic_patterns(move_evals: list[MoveEval]) -> list[dict]:
    """
    Detect strategic patterns from move evaluations.
    Returns list of pattern dicts for JSON storage.
    """
    patterns: list[dict] = []

    for i, ev in enumerate(move_evals):
        board = chess.Board(ev.fen)
        color = chess.WHITE if ev.color == "white" else chess.BLACK

        # Pawn structure errors: creating doubled/isolated pawns with mistakes
        if ev.classification in ("mistake", "blunder"):
            board_after = board.copy()
            board_after.push(chess.Move.from_uci(ev.move_uci))

            doubled_before = _count_doubled_pawns(board, color)
            doubled_after = _count_doubled_pawns(board_after, color)
            if doubled_after > doubled_before:
                patterns.append({
                    "type": "pawn_structure_weakened",
                    "move_number": ev.move_number,
                    "color": ev.color,
                    "severity": round(min(1.0, ev.centipawn_loss / 150), 3),
                    "fen": ev.fen,
                    "description": f"Move {ev.move_san} created doubled pawns",
                    "move_san": ev.move_san,
                })

            isolated_before = _count_isolated_pawns(board, color)
            isolated_after = _count_isolated_pawns(board_after, color)
            if isolated_after > isolated_before:
                patterns.append({
                    "type": "isolated_pawn_created",
                    "move_number": ev.move_number,
                    "color": ev.color,
                    "severity": round(min(1.0, ev.centipawn_loss / 150), 3),
                    "fen": ev.fen,
                    "description": f"Move {ev.move_san} created isolated pawn",
                    "move_san": ev.move_san,
                })

        # Weak square creation: user's mistake gives the opponent new outpost squares
        # _has_weak_squares(board, not color) = outpost opportunities for the opponent
        # in the user's own half — i.e., squares that are weak *for* the user.
        if ev.classification in ("mistake", "blunder") and i % 3 == 0:  # Sample to avoid N^2
            had_weak = _has_weak_squares(board, not color)
            if not had_weak:  # only flag if weakness is newly introduced
                board_after = board.copy()
                board_after.push(chess.Move.from_uci(ev.move_uci))
                if _has_weak_squares(board_after, not color):
                    patterns.append({
                        "type": "weak_squares_created",
                        "move_number": ev.move_number,
                        "color": ev.color,
                        "severity": round(min(1.0, ev.centipawn_loss / 200), 3),
                        "fen": ev.fen,
                        "description": f"Move {ev.move_san} created weak squares in position",
                        "move_san": ev.move_san,
                    })

        # Bishop vs Knight trade quality
        # Detects B×N and N×B captures and judges whether the trade
        # favoured the player given position openness.
        if ev.is_capture:
            move = chess.Move.from_uci(ev.move_uci)
            moving_piece   = board.piece_at(move.from_square)
            captured_piece = board.piece_at(move.to_square)
            if moving_piece and captured_piece:
                is_bvn = (
                    (moving_piece.piece_type == chess.BISHOP and captured_piece.piece_type == chess.KNIGHT) or
                    (moving_piece.piece_type == chess.KNIGHT and captured_piece.piece_type == chess.BISHOP)
                )
                if is_bvn:
                    is_open = _is_open_position(board)
                    # Bishop better in open, knight better in closed:
                    # • trading bishop for knight in closed = bishop gives up advantage → bad
                    # • trading knight for bishop in open = knight gives up advantage → bad
                    bad_trade = (
                        (moving_piece.piece_type == chess.BISHOP and not is_open) or
                        (moving_piece.piece_type == chess.KNIGHT and is_open)
                    )
                    ptype = "bishop_knight_trade_bad" if bad_trade else "bishop_knight_trade_ok"
                    desc = (
                        f"{'B×N in closed position (knight may be superior)' if moving_piece.piece_type == chess.BISHOP else 'N×B in open position (bishop may be superior)'}"
                        if bad_trade else
                        f"{'B×N in open position (appropriate exchange)' if moving_piece.piece_type == chess.BISHOP else 'N×B in closed position (appropriate exchange)'}"
                    )
                    patterns.append({
                        "type": ptype,
                        "move_number": ev.move_number,
                        "color": ev.color,
                        "severity": round(min(1.0, ev.centipawn_loss / 100), 3),
                        "fen": ev.fen,
                        "description": desc,
                        "move_san": ev.move_san,
                    })

    # Positional drift analysis
    drifts = _eval_drift(move_evals)
    for start_idx, drift_cp in drifts:
        ev = move_evals[start_idx]
        patterns.append({
            "type": "strategic_drift",
            "move_number": ev.move_number,
            "color": ev.color,
            "severity": round(min(1.0, drift_cp / 300), 3),
            "fen": ev.fen,
            "description": f"Position drifted -{drift_cp:.0f}cp over 8 moves without a single blunder (strategic misplay)",
            "move_san": ev.move_san,
        })

    return patterns
