from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.engine.stockfish import get_engine, shutdown_engine
from app.routers import games, profile, coaching, training, selfanalysis, admin, mental_tutor


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    try:
        await get_engine()
        print("Stockfish engine started.")
    except Exception as e:
        print(f"Warning: Could not start Stockfish: {e}")
    yield
    # Shutdown
    await shutdown_engine()
    print("Stockfish engine stopped.")


app = FastAPI(
    title="AI Chess Coach",
    description="Engine-first chess coaching with deterministic performance scoring",
    version="0.1.0",
    lifespan=lifespan,
)

from app.config import settings as _settings

_allowed_origins = [
    f"http://localhost:{_settings.frontend_port}",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(games.router)
app.include_router(profile.router)
app.include_router(coaching.router)
app.include_router(training.router)
app.include_router(selfanalysis.router)
app.include_router(mental_tutor.router)
app.include_router(admin.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
