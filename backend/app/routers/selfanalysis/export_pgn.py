"""
PGN export endpoint.
"""
import chess
import chess.pgn
import io
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Game, AnnotationSession
from .utils import _strip_html

router = APIRouter()

_ROOT_CAUSE_LABELS = {
    "never_considered":    "Never considered the best move",
    "rejected_wrong_reason": "Rejected it for the wrong reason",
    "miscalculated":       "Miscalculated the line",
    "plan_disconnect":     "Was following a different plan",
    "time_pressure":       "Ran out of time",
}

_CLASSIFICATION_NAG = {
    "inaccuracy": chess.pgn.NAG_DUBIOUS_MOVE,  # $6  ?!
    "mistake":    chess.pgn.NAG_MISTAKE,        # $2  ?
    "blunder":    chess.pgn.NAG_BLUNDER,        # $4  ??
}


@router.get("/session/{session_id}/export-pgn")
async def export_annotated_pgn(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Export the annotation session as an annotated PGN ready for Lichess study import.
    Returns text/plain with:
      - User annotations as move comments
      - NAGs ($2/$4/$6) matching mistake/blunder/inaccuracy
      - Engine best-move line as an alternative variation
      - Root-cause label in the comment when classified
    """
    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    game_result_q = await db.execute(select(Game).where(Game.id == session.game_id))
    game = game_result_q.scalar_one_or_none()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Parse original PGN
    try:
        pgn_game = chess.pgn.read_game(io.StringIO(game.pgn))
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse game PGN")

    if pgn_game is None:
        raise HTTPException(status_code=500, detail="Empty PGN")

    # Build annotation lookup: move_index → annotation dict
    moves_data = session.moves_data or []
    annotated: dict[int, dict] = {
        m["move_index"]: m
        for m in moves_data
        if not m.get("draft", False)
    }

    # Walk the mainline and inject annotations
    move_index = 0
    for node in pgn_game.mainline():
        ann = annotated.get(move_index)
        if ann:
            cls = ann.get("classification", "")
            nag = _CLASSIFICATION_NAG.get(cls)
            if nag:
                node.nags.add(nag)

            # Build comment text
            parts: list[str] = []

            user_text = _strip_html(ann.get("user_annotation", "") or "").strip()
            if user_text:
                parts.append(user_text)

            # Position assessment
            eval_label = ann.get("user_eval_label", "")
            eval_verdict = ann.get("eval_verdict", "")
            if eval_label:
                verdict_str = f" ({eval_verdict})" if eval_verdict and eval_verdict != "correct" else ""
                parts.append(f"I assessed: {eval_label}{verdict_str}")

            # Candidate moves the user considered
            candidates = ann.get("user_candidates") or []
            if candidates:
                parts.append(f"Candidates considered: {', '.join(candidates)}")

            # Engine evaluation
            cp = ann.get("centipawn_loss", 0.0)
            eval_before = ann.get("engine_eval_before", 0.0)
            if cls in ("mistake", "blunder", "inaccuracy"):
                best = ann.get("engine_best_move", "")
                parts.append(
                    f"Engine: {best} was better (−{int(cp)} cp)"
                    if best else f"Engine: −{int(cp)} cp loss"
                )

            # Root cause
            rc = ann.get("root_cause", "")
            if rc:
                parts.append(f"Error type: {_ROOT_CAUSE_LABELS.get(rc, rc)}")

            node.comment = " | ".join(parts)

            # Add engine best-move as an alternative variation (only for mistakes/blunders)
            if cls in ("mistake", "blunder") and ann.get("engine_best_move_uci"):
                try:
                    parent_board = node.parent.board()
                    best_uci = ann["engine_best_move_uci"]
                    best_move = chess.Move.from_uci(best_uci)
                    if best_move in parent_board.legal_moves:
                        var_node = node.parent.add_variation(best_move)
                        var_node.comment = "Engine best"
                        # Add PV continuation (up to 3 moves)
                        pv = ann.get("engine_pv_san") or []
                        var_board = parent_board.copy()
                        var_board.push(best_move)
                        var_cur = var_node
                        for san in pv[1:4]:  # first move already added
                            try:
                                m = var_board.parse_san(san)
                                var_cur = var_cur.add_variation(m)
                                var_board.push(m)
                            except Exception:
                                break
                except Exception:
                    pass  # never break export for variation errors

        move_index += 1

    # Stamp the exporter in headers
    pgn_game.headers["Annotator"] = "ChessTutor Self-Analysis"

    # Serialize
    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    pgn_text = pgn_game.accept(exporter)

    filename = f"self_analysis_session_{session_id}.pgn"
    return Response(
        content=pgn_text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
