"""
Self-analysis router package.
Aggregates all sub-routers under the /selfanalysis prefix.
"""
from fastapi import APIRouter
from .session import router as session_router
from .streaming import router as streaming_router
from .coaching import router as coaching_router
from .history import router as history_router
from .stats import router as stats_router
from .export_pgn import router as export_pgn_router

router = APIRouter(prefix="/selfanalysis", tags=["selfanalysis"])
router.include_router(session_router)
router.include_router(streaming_router)
router.include_router(coaching_router)
router.include_router(history_router)
router.include_router(stats_router)
router.include_router(export_pgn_router)
