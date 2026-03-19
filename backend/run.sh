#!/bin/bash
# Start the FastAPI backend
cd "$(dirname "$0")"

BACKEND_PORT=${BACKEND_PORT:-8000}

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
fi

.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload
