"""
Stockfish 18 wrapper using python-chess async UCI engine interface.
Uses N+1 position analyses for a game of N moves (one analysis per position,
reusing evals between consecutive moves).
"""
import asyncio
import re
import chess
import chess.engine
import chess.pgn
import io
from dataclasses import dataclass
from typing import Optional
from app.config import settings


def _parse_clk(comment: str) -> float | None:
    """Extract clock remaining (seconds) from a PGN node comment.
    Handles both HH:MM:SS and MM:SS formats from Lichess/Chess.com PGNs.
    """
    m = re.search(r'\[%clk (\d+):(\d+):(\d+)\]', comment)
    if m:
        h, mn, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return float(h * 3600 + mn * 60 + s)
    m = re.search(r'\[%clk (\d+):(\d+)\]', comment)
    if m:
        mn, s = int(m.group(1)), int(m.group(2))
        return float(mn * 60 + s)
    return None


@dataclass
class MoveEval:
    fen: str
    move_uci: str
    move_san: str
    eval_before: float          # centipawns from mover's perspective before move
    eval_after: float           # centipawns from mover's perspective after move
    best_move_uci: str
    best_move_san: str
    eval_best: float            # = eval_before (best achievable)
    centipawn_loss: float       # eval_best - eval_after (always >= 0)
    classification: str         # best/good/inaccuracy/mistake/blunder
    is_capture: bool
    is_check: bool
    move_number: int
    color: str                  # "white" or "black"
    pv_san: list = None         # engine principal variation in SAN (up to 5 moves)
    pv_uci: list = None         # engine principal variation in UCI (up to 5 moves)
    clock_remaining: float = None  # seconds left on clock after this move (from %clk)


def _pov_cp(score: chess.engine.PovScore, color: chess.Color) -> float:
    """Return score in centipawns from the given color's perspective."""
    pov = score.pov(color)
    if pov.is_mate():
        return 10000.0 if pov.mate() > 0 else -10000.0
    return float(pov.score())


def _pv_uci_to_san_board(board: chess.Board, pv: list[chess.Move]) -> list[str]:
    """Convert a list of chess.Move objects to SAN notation from the given board state."""
    b = board.copy()
    san_moves = []
    for move in pv:
        try:
            san_moves.append(b.san(move))
            b.push(move)
        except Exception:
            break
    return san_moves


def classify_move(centipawn_loss: float) -> str:
    if centipawn_loss < 10:
        return "best"
    elif centipawn_loss < 25:
        return "good"
    elif centipawn_loss < 60:
        return "inaccuracy"
    elif centipawn_loss < 120:
        return "mistake"
    else:
        return "blunder"


class StockfishEngine:
    """
    Async Stockfish engine wrapper.
    A single instance should be reused across analyses.
    All public methods are coroutines and must be called from the same event loop.
    """

    def __init__(self):
        self._transport = None
        self._engine: Optional[chess.engine.UciProtocol] = None
        self._lock = asyncio.Lock()

    async def start(self):
        self._transport, self._engine = await chess.engine.popen_uci(settings.stockfish_path)
        await self._engine.configure({
            "Threads": settings.stockfish_threads,
            "Hash": settings.stockfish_hash_mb,
        })

    async def stop(self):
        if self._engine:
            await self._engine.quit()
            self._engine = None
            self._transport = None

    @property
    def is_running(self) -> bool:
        return self._engine is not None

    async def _analyse(self, board: chess.Board, depth: int) -> chess.engine.InfoDict:
        """Single position analysis (serialized via lock)."""
        async with self._lock:
            return await self._engine.analyse(board, chess.engine.Limit(depth=depth))

    async def analyse_game(self, pgn_text: str, depth: int = None) -> list[MoveEval]:
        """
        Analyse every move in a PGN game.
        Performs N+1 engine calls for N moves by reusing position evals.
        """
        depth = depth or settings.analysis_depth
        game = chess.pgn.read_game(io.StringIO(pgn_text))
        if not game:
            return []

        # Collect nodes (for clock data) and moves together
        nodes = list(game.mainline())
        main_line = [n.move for n in nodes]
        if not main_line:
            return []

        # Extract clock remaining (seconds) from each node's comment
        clocks: list[float | None] = [_parse_clk(n.comment or "") for n in nodes]

        # Build all N+1 board states
        boards: list[chess.Board] = []
        board = game.board()
        boards.append(board.copy())
        for move in main_line:
            board.push(move)
            boards.append(board.copy())

        # Analyse all positions once — this is the key efficiency win
        infos: list[chess.engine.InfoDict] = []
        for b in boards:
            info = await self._analyse(b, depth)
            infos.append(info)

        # Build MoveEval entries
        evaluations: list[MoveEval] = []
        board = game.board()

        for i, move in enumerate(main_line):
            color = board.turn                    # color of the player making this move
            color_str = "white" if color == chess.WHITE else "black"
            fen_before = boards[i].fen()

            san = boards[i].san(move)
            is_capture = boards[i].is_capture(move)
            is_check = boards[i + 1].is_check()

            info_before = infos[i]
            info_after = infos[i + 1]

            # Best move and its eval (from mover's perspective)
            pv_moves = info_before.get("pv", [move])
            best_move_obj = pv_moves[0]
            best_move_san = boards[i].san(best_move_obj)
            eval_best = _pov_cp(info_before["score"], color)
            pv_san = _pv_uci_to_san_board(boards[i], pv_moves[:5])
            pv_uci = [m.uci() for m in pv_moves[:5]]

            # Eval of position after actual move, from the original mover's perspective
            # info_after is from the opponent's (not color) perspective, so negate
            eval_after = -_pov_cp(info_after["score"], not color)

            # If the player played the engine's exact best move, cp_loss is 0 by
            # definition — independent search calls can diverge (horizon effect),
            # so we never penalise playing the engine's own top choice.
            if move == best_move_obj:
                centipawn_loss = 0.0
            else:
                centipawn_loss = max(0.0, eval_best - eval_after)
            classification = classify_move(centipawn_loss)

            evaluations.append(MoveEval(
                fen=fen_before,
                move_uci=move.uci(),
                move_san=san,
                eval_before=eval_best,
                eval_after=eval_after,
                best_move_uci=best_move_obj.uci(),
                best_move_san=best_move_san,
                eval_best=eval_best,
                centipawn_loss=centipawn_loss,
                classification=classification,
                is_capture=is_capture,
                is_check=is_check,
                move_number=boards[i].fullmove_number,
                color=color_str,
                pv_san=pv_san,
                pv_uci=pv_uci,
                clock_remaining=clocks[i],
            ))
            board.push(move)

        return evaluations

    async def evaluate_move(
        self, fen: str, move_uci: str, eval_before: float = None, depth: int = None
    ) -> dict:
        """
        Evaluate a specific move in a position.
        Returns centipawn loss and classification for that move.
        Passing eval_before skips re-analysing the initial position (saves one engine call).
        """
        depth = depth or settings.analysis_depth
        board = chess.Board(fen)
        move = chess.Move.from_uci(move_uci)
        move_san = board.san(move)
        color = board.turn

        if eval_before is None:
            info_before = await self._analyse(board, depth)
            eval_before = _pov_cp(info_before["score"], color)

        board.push(move)
        info_after = await self._analyse(board, depth)
        eval_after = -_pov_cp(info_after["score"], board.turn)   # back to original mover's pov

        cp_loss = max(0.0, eval_before - eval_after)
        return {
            "move_san": move_san,
            "eval_after": eval_after,
            "centipawn_loss": cp_loss,
            "classification": classify_move(cp_loss),
        }

    async def get_best_move(self, fen: str, depth: int = None) -> dict:
        """Get best move for a given FEN position."""
        depth = depth or settings.stockfish_depth
        board = chess.Board(fen)
        info = await self._analyse(board, depth)
        best_move = info["pv"][0] if info.get("pv") else None
        return {
            "best_move_uci": best_move.uci() if best_move else None,
            "best_move_san": board.san(best_move) if best_move else None,
            "score_cp": _pov_cp(info["score"], board.turn),
            "pv": [m.uci() for m in info.get("pv", [])[:5]],
        }

    async def get_multipv(self, fen: str, num_pv: int = 4, depth: int = None) -> list[dict]:
        """
        Get top N principal variations for a position (used for critical moves).
        Returns list of {rank, move_san, score_cp, pv_san} dicts.
        """
        depth = depth or 25
        board = chess.Board(fen)
        async with self._lock:
            results = await self._engine.analyse(
                board, chess.engine.Limit(depth=depth), multipv=num_pv
            )
        if isinstance(results, dict):
            results = [results]

        lines = []
        for i, info in enumerate(results):
            pv = info.get("pv", [])
            if not pv:
                continue
            best = pv[0]
            pv_san = _pv_uci_to_san_board(board, pv[:5])
            lines.append({
                "rank": i + 1,
                "move_san": board.san(best),
                "move_uci": best.uci(),
                "score_cp": _pov_cp(info["score"], board.turn),
                "pv_san": pv_san,
            })
        return lines


# Global singleton
_engine_instance: Optional[StockfishEngine] = None


async def get_engine() -> StockfishEngine:
    global _engine_instance
    if _engine_instance is None or not _engine_instance.is_running:
        _engine_instance = StockfishEngine()
        await _engine_instance.start()
    return _engine_instance


async def shutdown_engine():
    global _engine_instance
    if _engine_instance:
        await _engine_instance.stop()
        _engine_instance = None
