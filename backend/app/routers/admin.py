"""
Admin utilities — destructive operations that require explicit confirmation.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db, Base, engine

router = APIRouter(prefix="/admin", tags=["admin"])


@router.delete("/reset")
async def reset_database():
    """
    Drop and recreate all tables, wiping every row from the database.
    This is irreversible — the caller must have already confirmed.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    return {"detail": "Database reset successfully. All data has been deleted."}
