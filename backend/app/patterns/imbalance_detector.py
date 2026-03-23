"""
Positional imbalance detection and strategic plan generation.

Analyzes positions in terms of human-relevant imbalances (material, king safety,
piece activity, pawn structure, space) and derives actionable plans.
"""
import chess

# Material values in centipawns
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 300,
    chess.BISHOP: 320,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}

# Plan labels → human-readable display
PLAN_LABELS = {
    "attack_king": "Attack the king",
    "defend_king": "Defend your king",
    "simplify": "Simplify the position",
    "complicate": "Create complications",
    "maintain_pressure": "Maintain pressure",
    "improve_worst_piece": "Improve your worst piece",
    "restrict_opponent": "Restrict the opponent",
    "create_counterplay": "Create counterplay",
    "maintain_balance": "Maintain balance",
    "open_center": "Open the center",
}

# Short explanation subtext per plan
PLAN_SUBTEXTS = {
    "attack_king": "Exploit the weak king with direct threats",
    "defend_king": "Secure your king before launching attacks",
    "simplify": "Trade pieces to convert your advantage",
    "complicate": "Create complications to generate counterplay",
    "maintain_pressure": "Keep pieces active and increase pressure",
    "improve_worst_piece": "Activate your least useful piece",
    "restrict_opponent": "Limit opponent's piece activity and space",
    "create_counterplay": "Seek counterchances before the position closes",
    "maintain_balance": "Play solid moves and wait for opportunities",
    "open_center": "Challenge the pawn center for dynamic play",
}


def _material_balance(board: chess.Board) -> int:
    """Returns material balance in centipawns (positive = white ahead)."""
    balance = 0
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.piece_type != chess.KING:
            val = PIECE_VALUES[piece.piece_type]
            balance += val if piece.color == chess.WHITE else -val
    return balance


def _king_safety_score(board: chess.Board, color: chess.Color) -> int:
    """
    Returns a safety score (higher = safer king).
    Considers: pawn shield, open files near king, enemy piece proximity.
    """
    king_sq = board.king(color)
    if king_sq is None:
        return 5

    king_file = chess.square_file(king_sq)
    king_rank = chess.square_rank(king_sq)
    forward = 1 if color == chess.WHITE else -1
    enemy = not color

    # Pawn shield: friendly pawns in front of king (1-2 ranks ahead)
    pawn_shield = 0
    for df in [-1, 0, 1]:
        for dr in [1, 2]:
            f = king_file + df
            r = king_rank + (forward * dr)
            if 0 <= f <= 7 and 0 <= r <= 7:
                piece = board.piece_at(chess.square(f, r))
                if piece and piece.piece_type == chess.PAWN and piece.color == color:
                    pawn_shield += 1

    # Open files near king (no pawns of any color = dangerous)
    open_files_near = 0
    for df in [-1, 0, 1]:
        f = king_file + df
        if 0 <= f <= 7:
            has_pawn = any(
                board.piece_at(chess.square(f, r)) and
                board.piece_at(chess.square(f, r)).piece_type == chess.PAWN
                for r in range(8)
            )
            if not has_pawn:
                open_files_near += 1

    # Enemy piece proximity (how many squares near king are attacked by enemy)
    enemy_attacks_near = sum(
        1 for df in range(-2, 3) for dr in range(-2, 3)
        if 0 <= king_file + df <= 7 and 0 <= king_rank + dr <= 7
        and board.is_attacked_by(enemy, chess.square(king_file + df, king_rank + dr))
    )

    return pawn_shield * 2 - open_files_near * 2 - enemy_attacks_near // 3


def _piece_mobility(board: chess.Board, color: chess.Color) -> int:
    """Count pseudo-legal moves for a given color (rough activity measure)."""
    board_copy = board.copy()
    board_copy.turn = color
    return sum(1 for _ in board_copy.generate_pseudo_legal_moves())


def _centralization(board: chess.Board, color: chess.Color) -> float:
    """Score how well pieces (excluding pawns/king) are centralized (0..1)."""
    CENTER = {chess.D4, chess.D5, chess.E4, chess.E5}
    EXTENDED = {
        chess.C3, chess.C4, chess.C5, chess.C6,
        chess.D3, chess.D6, chess.E3, chess.E6,
        chess.F3, chess.F4, chess.F5, chess.F6,
    }
    total = 0
    pieces = 0
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.color == color and piece.piece_type not in (chess.PAWN, chess.KING):
            pieces += 1
            if sq in CENTER:
                total += 2
            elif sq in EXTENDED:
                total += 1
    if pieces == 0:
        return 0.5
    return min(1.0, total / (pieces * 1.5))


def _space_score(board: chess.Board, color: chess.Color) -> int:
    """Count squares in opponent's half controlled by this color."""
    ranks = range(4, 8) if color == chess.WHITE else range(0, 4)
    return sum(
        1 for rank in ranks for f in range(8)
        if board.is_attacked_by(color, chess.square(f, rank))
    )


def _pawn_structure_score(board: chess.Board, color: chess.Color) -> float:
    """
    Returns a score 0..1 where higher = healthier pawn structure.
    Penalizes doubled and isolated pawns; rewards passed pawns.
    """
    pawn_files: list[int] = []
    pawns: list[int] = []
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.piece_type == chess.PAWN and piece.color == color:
            pawn_files.append(chess.square_file(sq))
            pawns.append(sq)

    if not pawn_files:
        return 0.5

    # Doubled pawns
    from collections import Counter
    file_counts = Counter(pawn_files)
    doubled = sum(c - 1 for c in file_counts.values() if c > 1)

    # Isolated pawns
    files_set = set(pawn_files)
    isolated = sum(
        1 for f in files_set
        if (f - 1) not in files_set and (f + 1) not in files_set
    )

    # Passed pawns
    enemy = not color
    passed = 0
    for sq in pawns:
        f = chess.square_file(sq)
        r = chess.square_rank(sq)
        is_passed = True
        for adj_f in [f - 1, f, f + 1]:
            if not (0 <= adj_f <= 7):
                continue
            for er in range(8):
                epiece = board.piece_at(chess.square(adj_f, er))
                if epiece and epiece.piece_type == chess.PAWN and epiece.color == enemy:
                    if color == chess.WHITE and er > r:
                        is_passed = False
                    elif color == chess.BLACK and er < r:
                        is_passed = False
        if is_passed:
            passed += 1

    n = len(pawns)
    penalty = (doubled * 0.3 + isolated * 0.2) / max(n, 1)
    bonus = passed * 0.15
    return max(0.0, min(1.0, 0.7 - penalty + bonus))


def detect_imbalances(board: chess.Board, user_color: chess.Color) -> dict:
    """
    Detect human-relevant positional imbalances from the board position.
    Returns a dict with five imbalance dimensions.
    """
    # Material
    mat = _material_balance(board)
    if abs(mat) <= 100:
        material = "equal"
    elif mat > 0:
        material = "white_better"
    else:
        material = "black_better"

    # King safety
    ws = _king_safety_score(board, chess.WHITE)
    bs = _king_safety_score(board, chess.BLACK)
    if ws < -2:
        king_safety = "white_unsafe"
    elif bs < -2:
        king_safety = "black_unsafe"
    elif ws < 2:
        king_safety = "white_slightly_exposed"
    elif bs < 2:
        king_safety = "black_slightly_exposed"
    else:
        king_safety = "both_safe"

    # Piece activity (mobility + centralization combined)
    wm = _piece_mobility(board, chess.WHITE) * 0.6 + _centralization(board, chess.WHITE) * 10
    bm = _piece_mobility(board, chess.BLACK) * 0.6 + _centralization(board, chess.BLACK) * 10
    diff = wm - bm
    if abs(diff) < 4:
        piece_activity = "equal"
    elif diff > 0:
        piece_activity = "white_better"
    else:
        piece_activity = "black_better"

    # Pawn structure
    wpq = _pawn_structure_score(board, chess.WHITE)
    bpq = _pawn_structure_score(board, chess.BLACK)
    pdiff = wpq - bpq
    if abs(pdiff) < 0.1:
        pawn_structure = "equal"
    elif pdiff > 0:
        pawn_structure = "white_better"
    else:
        pawn_structure = "black_better"

    # Space
    wsp = _space_score(board, chess.WHITE)
    bsp = _space_score(board, chess.BLACK)
    sdiff = wsp - bsp
    if abs(sdiff) < 4:
        space = "equal"
    elif sdiff > 0:
        space = "white_more"
    else:
        space = "black_more"

    return {
        "material": material,
        "king_safety": king_safety,
        "piece_activity": piece_activity,
        "pawn_structure": pawn_structure,
        "space": space,
    }


def generate_plans(imbalances: dict, user_color: chess.Color) -> list[str]:
    """
    Translate imbalances into actionable plans for the user.
    Returns up to 2 recommended plan labels (priority-ordered).
    """
    uc = "white" if user_color == chess.WHITE else "black"
    opp = "black" if uc == "white" else "white"
    plans: list[str] = []

    ks = imbalances.get("king_safety", "both_safe")
    mat = imbalances.get("material", "equal")
    pa = imbalances.get("piece_activity", "equal")
    ps = imbalances.get("pawn_structure", "equal")
    sp = imbalances.get("space", "equal")

    # King safety drives the most urgent plans
    if ks in (f"{opp}_unsafe", f"{opp}_slightly_exposed"):
        plans.append("attack_king")
    elif ks in (f"{uc}_unsafe", f"{uc}_slightly_exposed"):
        plans.append("defend_king")

    # Material imbalance
    if mat == f"{uc}_better" and "simplify" not in plans:
        plans.append("simplify")
    elif mat == f"{opp}_better" and "complicate" not in plans:
        plans.append("complicate")

    # Piece activity
    if pa == f"{uc}_better" and "attack_king" not in plans and "maintain_pressure" not in plans:
        plans.append("maintain_pressure")
    elif pa == f"{opp}_better" and "improve_worst_piece" not in plans:
        plans.append("improve_worst_piece")

    # Pawn structure
    if ps == f"{uc}_better" and "simplify" not in plans:
        plans.append("simplify")
    elif ps == f"{opp}_better" and "create_counterplay" not in plans:
        plans.append("create_counterplay")

    # Space
    if sp == f"{uc}_more" and "restrict_opponent" not in plans and "attack_king" not in plans:
        plans.append("restrict_opponent")
    elif sp == f"{opp}_more" and "improve_worst_piece" not in plans:
        plans.append("improve_worst_piece")

    if not plans:
        plans.append("maintain_balance")

    return plans[:2]


def evaluate_plan_consistency(
    move_uci: str,
    board: chess.Board,
    recommended_plans: list[str],
    user_color: chess.Color,
) -> dict:
    """
    Evaluate whether a move aligns with the recommended plans.
    Returns {"plan_consistency": "aligned"|"neutral"|"violation", "reason": str}.
    """
    try:
        move = chess.Move.from_uci(move_uci)
        if move not in board.legal_moves:
            return {"plan_consistency": "neutral", "reason": "Move not evaluatable"}
    except Exception:
        return {"plan_consistency": "neutral", "reason": "Move not evaluatable"}

    board_after = board.copy()
    board_after.push(move)

    moving_piece = board.piece_at(move.from_square)
    is_capture = board.is_capture(move)
    gives_check = board_after.is_check()

    uc = "white" if user_color == chess.WHITE else "black"
    opp = "black" if uc == "white" else "white"

    imb_before = detect_imbalances(board, user_color)
    imb_after = detect_imbalances(board_after, user_color)

    aligned_reasons: list[str] = []
    violation_reasons: list[str] = []

    for plan in recommended_plans:
        if plan == "attack_king":
            enemy_king_sq = board.king(not user_color)
            if gives_check:
                aligned_reasons.append("directly threatens the enemy king")
            elif is_capture:
                aligned_reasons.append("removes defensive material near the king")
            elif moving_piece and moving_piece.piece_type in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT):
                if enemy_king_sq is not None:
                    king_file = chess.square_file(enemy_king_sq)
                    to_file = chess.square_file(move.to_square)
                    if abs(to_file - king_file) <= 2:
                        aligned_reasons.append("moves attacking piece toward the enemy king")

        elif plan == "defend_king":
            ks_before = imb_before.get("king_safety", "both_safe")
            ks_after = imb_after.get("king_safety", "both_safe")
            if f"{uc}_unsafe" in ks_before and f"{uc}_unsafe" not in ks_after:
                aligned_reasons.append("improves king safety")
            elif moving_piece and moving_piece.piece_type == chess.KING:
                aligned_reasons.append("moves king to safety")

        elif plan == "simplify":
            if is_capture:
                aligned_reasons.append("simplifies by trading pieces")

        elif plan == "improve_worst_piece":
            if moving_piece and moving_piece.piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK):
                pa_before = imb_before.get("piece_activity", "equal")
                pa_after = imb_after.get("piece_activity", "equal")
                if pa_after == f"{uc}_better" and pa_before != f"{uc}_better":
                    aligned_reasons.append("improves piece activity")
                else:
                    aligned_reasons.append("activates a piece")

        elif plan == "maintain_pressure":
            if gives_check or is_capture:
                aligned_reasons.append("maintains concrete threats")
            elif moving_piece and moving_piece.piece_type in (chess.QUEEN, chess.ROOK):
                aligned_reasons.append("maintains active piece pressure")

        elif plan == "restrict_opponent":
            if moving_piece and moving_piece.piece_type == chess.PAWN:
                sp_after = imb_after.get("space", "equal")
                if sp_after == f"{uc}_more":
                    aligned_reasons.append("gains space and restricts opponent")

        elif plan in ("maintain_balance", "complicate", "create_counterplay"):
            # Any reasonable move is acceptable here
            aligned_reasons.append("consistent with the position's needs")

    if aligned_reasons:
        return {"plan_consistency": "aligned", "reason": aligned_reasons[0].capitalize()}

    # Check for clear violations
    for plan in recommended_plans:
        if plan == "attack_king":
            if moving_piece and moving_piece.piece_type in (chess.QUEEN, chess.ROOK):
                enemy_king_sq = board.king(not user_color)
                if enemy_king_sq is not None:
                    king_file = chess.square_file(enemy_king_sq)
                    from_dist = abs(chess.square_file(move.from_square) - king_file)
                    to_dist = abs(chess.square_file(move.to_square) - king_file)
                    if to_dist > from_dist + 2 and not is_capture:
                        violation_reasons.append("moves key attacking piece away from enemy king")
        elif plan == "defend_king":
            if moving_piece and moving_piece.piece_type in (chess.QUEEN, chess.ROOK):
                ks_before = imb_before.get("king_safety", "both_safe")
                if f"{uc}_unsafe" in ks_before and not is_capture:
                    violation_reasons.append("ignores own king's vulnerability")

    if violation_reasons:
        return {"plan_consistency": "violation", "reason": violation_reasons[0].capitalize()}

    return {"plan_consistency": "neutral", "reason": "Does not directly impact the main plan"}


def imbalances_to_display(imbalances: dict, user_color: chess.Color) -> list[dict]:
    """
    Convert raw imbalance dict to display-friendly list for the frontend.
    Returns list of {label, value, status} where status is 'good', 'bad', or 'neutral'.
    """
    uc = "white" if user_color == chess.WHITE else "black"
    opp = "black" if uc == "white" else "white"

    def mat_label(v):
        if v == "equal": return "Equal", "neutral"
        if v == f"{uc}_better": return "You're ahead", "good"
        return "Opponent ahead", "bad"

    def ks_label(v):
        if v == "both_safe": return "Both safe", "neutral"
        if v == f"{uc}_unsafe": return "Your king unsafe", "bad"
        if v == f"{opp}_unsafe": return "Enemy king unsafe", "good"
        if v == f"{uc}_slightly_exposed": return "Slightly exposed", "bad"
        if v == f"{opp}_slightly_exposed": return "Enemy exposed", "good"
        return v.replace("_", " ").title(), "neutral"

    def act_label(v):
        if v == "equal": return "Equal", "neutral"
        if v == f"{uc}_better": return "Your pieces active", "good"
        return "Opponent more active", "bad"

    def ps_label(v):
        if v == "equal": return "Equal", "neutral"
        if v == f"{uc}_better": return "Your structure better", "good"
        return "Opponent structure better", "bad"

    def sp_label(v):
        if v == "equal": return "Equal", "neutral"
        if v == f"{uc}_more": return "You have more space", "good"
        return "Opponent has more space", "bad"

    mat_val, mat_status = mat_label(imbalances.get("material", "equal"))
    ks_val, ks_status = ks_label(imbalances.get("king_safety", "both_safe"))
    act_val, act_status = act_label(imbalances.get("piece_activity", "equal"))
    ps_val, ps_status = ps_label(imbalances.get("pawn_structure", "equal"))
    sp_val, sp_status = sp_label(imbalances.get("space", "equal"))

    return [
        {"label": "Material", "value": mat_val, "status": mat_status},
        {"label": "King Safety", "value": ks_val, "status": ks_status},
        {"label": "Piece Activity", "value": act_val, "status": act_status},
        {"label": "Pawn Structure", "value": ps_val, "status": ps_status},
        {"label": "Space", "value": sp_val, "status": sp_status},
    ]
