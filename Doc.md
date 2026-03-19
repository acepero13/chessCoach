# ChessTutor — Features & Project Overview

This document lists and details the features the ChessTutor project offers, how the pieces fit together, and how to run and extend the system.

-----

## 1. High-level summary

ChessTutor is an offline-first, engine-led chess coaching platform. It analyzes batches of games with Stockfish, classifies tactical and strategic patterns, computes deterministic performance scores, generates training plans, and offers an interactive coaching mode that uses an LLM only for grounded explanation (no hallucinated evaluations).

Key goals:
- Deterministic, measurable scoring (0–100) across multiple skill axes
- Engine-first analysis (Stockfish 18 required)
- Local LLM integration for explanatory text only (must be grounded in engine data)
- Reproducible training plans derived from analysis

-----

## 2. Feature list (detailed)

- Game Import
  - Import from Lichess / Chess.com (fetch routines expected in future integration)
  - Upload PGN files
  - Store parsed games in a local DB (`backend/chess_tutor.db`)

- Batch Analysis
  - Analyze N latest games (e.g., last 40)
  - Engine analysis using Stockfish (`backend/app/engine/stockfish.py`)
  - Move-level classification and motif detection (tactical + strategic)
  - Compute deterministic metrics (centipawn loss, blunders, mate threats, etc.)
  - Produce structured JSON analysis output per game

- Pattern detection
  - Tactical detectors: forks, pins, hanging pieces, discovered attacks, missed tactical shots
  - Strategic detectors: pawn-structure issues, weak squares, poor coordination
  - Pattern modules located in `backend/app/patterns/`

- Scoring Engine (deterministic)
  - Nine normalized scores (0–100): Attack, Defense, Opening, Strategy, Endgame, Tactics, Time Management, Conversion, Mental Stability
  - Based on deterministic metrics (no LLM-inferred traits)
  - Implementations live in `backend/app/analysis/score_calculator.py`

- Game Selection
  - Select games that best illustrate user's weaknesses (lowest two scores, motif severity, centipawn loss)
  - Used by the frontend when building study sets
  - Core logic in `backend/app/analysis/game_selector.py`

- Interactive Coaching Session
  - Position-centered coaching flow: shows board, asks user to respond, then reveals engine lines and explanation
  - LLM (`backend/app/llm/explainer.py`) used only to turn engine + pattern data into pedagogical explanations (no independent eval)
  - Workflow: hide engine eval -> prompt user -> reveal engine and motifs -> LLM explains grounded rationale

- Training Plan Generator
  - Deterministic 4-week plan derived from user's performance profile
  - Drill assignment logic maps weak scores -> specific drills (e.g., forks/pins when tactics low)
  - Time allocation and recommended time controls
  - Implemented in `backend/app/training/plan_generator.py`

- Export / API
  - REST-like routers in `backend/app/routers/` covering: games, profile, selfanalysis, training, coaching, admin
  - JSON endpoints return structured analysis, selected games, training plans, and coaching prompts

- Frontend features
  - Dashboard with radar (scores), trends, blunder heatmap, opening breakdown
  - Game import UI, game list & review, training plan page, interactive coaching UI
  - Frontend app in `frontend/src/` and components under `frontend/src/components/`

- Local-first / offline design
  - Stockfish must be run locally
  - LLM runs locally (or via a configured local LLM provider) and must be constrained to use only provided structured data for evaluations

-----

## 3. Architecture & important files

- backend/
  - `app/main.py` — application entrypoint (server bootstrap)
  - `app/config.py` — config and environment details
  - `app/database.py` — DB initialization and ORM (SQLite `chess_tutor.db` by default)
  - `app/models.py` — DB models
  - `app/analysis/` — `batch_analyzer.py`, `score_calculator.py`, `game_selector.py`
  - `app/engine/stockfish.py` — Stockfish wrapper (depth and concurrency configuration)
  - `app/patterns/` — detectors: `tactical_detectors.py`, `strategic_detectors.py`
  - `app/llm/explainer.py` — LLM prompt/response generation for grounded explanations
  - `app/training/plan_generator.py` — deterministic mapping to drills and weekly schedules
  - `app/routers/` — modular routers used by the server to expose endpoints

- frontend/
  - `src/components/` — UI components (GameList, GameImport, PatternDrillModal, ScoreRadar)
  - `src/pages/` — pages corresponding to CoachingSession, Dashboard, GameReview, TrainingPlan
  - `api/client.js` — front->backend API client

-----

## 4. Scoring summary (how scores are computed at a glance)

Scores are 0–100 normalized values produced deterministically from measurable metrics:
- Attack: successful tactical sequences, mate threat frequency, eval gains from aggressive lines
- Defense: saved-only-moves, avoided blunders while attacked, reduction in opponent eval swings
- Opening: average eval after move 10, early mistake frequency, theoretical deviation penalty
- Strategy: pawn-structure errors, weak squares, long-term eval drift without tactics
- Endgame: conversion rate from +2, missed endgame technique errors
- Tactics: missed forks/pins/hanging pieces
- Time Management: (if timestamps available) blunders in time trouble, avg time per move
- Conversion: percentage of positions > +2 converted to wins, moves-to-convert
- Mental Stability: blunder clustering, post-blunder collapse

See `score_calculator.py` for precise formulae and weights.

-----

## 5. API & endpoints (quick reference)

The backend exposes modular routers (see `backend/app/routers/`):

- /games
  - POST /games/import — upload PGN / import metadata
  - GET /games — list games with filters
  - GET /games/:id/analysis — detailed analysis for a game

- /analysis
  - POST /analysis/batch — start batch analysis
  - GET /analysis/status/:job_id — check status

- /profile
  - GET /profile — current performance profile (latest snapshot)
  - GET /profile/history — historical snapshots

- /training
  - POST /training/plan — create a training plan from current profile
  - GET /training/plan/:id — fetch plan

- /coaching
  - POST /coaching/session — start a coaching session (returns positions/questions)
  - POST /coaching/session/:id/answer — submit user answer and get explanation

Note: these routes reflect the routers present but may be trimmed or refactored — consult `backend/app/routers/` for exact function names and payloads.

-----

## 6. Running locally (developer quickstart)

Prerequisites:
- Python 3.11+ (project uses v3.13 pyc files; 3.11+ recommended)
- Stockfish 18 installed and reachable by `backend/app/engine/stockfish.py`
- Optional: a local LLM provider configured for `backend/app/llm/explainer.py`

Quick run (development):
1. cd backend
2. create a virtualenv and install: `pip install -r requirements.txt`
3. ensure `chess_tutor.db` exists (a minimal DB is included)
4. run the backend: `./run.sh` (or `python -m app.main`) — this starts the API server
5. for frontend: cd frontend && `npm install` && `npm run dev` (vite)

Notes on configuration: see `backend/app/config.py` and `frontend/package.json` for env variables and ports.

-----

## 7. Design constraints & guarantees

- Deterministic scoring: every score must be reproducible from the same analysis inputs
- Engine-first: all position evaluations and tactical correctness come from Stockfish
- LLM safety: LLM functions only produce textual explanations and must not override engine data
- Offline-capable: system designed to work entirely locally when required

-----

## 8. Developer notes & where to look for work

Suggested entry points:
- To inspect batch analysis: `backend/app/analysis/batch_analyzer.py`
- To review scoring formulas: `backend/app/analysis/score_calculator.py`
- To read tactical detectors: `backend/app/patterns/tactical_detectors.py`
- To see Stockfish wrapper: `backend/app/engine/stockfish.py`

Small, high-value improvements:
- Add unit tests around `score_calculator` (happy path + edge cases)
- Add CLI script to run a quick analysis on a PGN file and print the profile JSON
- Add schema docs for produced JSON (OpenAPI or JSON Schema)

-----

## 9. Next steps & roadmap suggestions

- Implement a stable import connector for Lichess/Chess.com with OAuth
- Add tablebase checks for endgame improvements
- Harden concurrency for batch analyzer to satisfy the "40 games under 5 minutes" requirement
- Add reproducible regression tests for scoring (fixtures + expected scores)

-----

## 10. Contact / authorship

Project notes and product spec live in `CLAUDE.md`.

-----

(End of features document)

