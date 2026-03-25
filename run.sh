#!/bin/bash

# ChessTutor - Start both backend and frontend

# Find a free port starting from a base
find_free_port() {
    local port=$1
    while lsof -i :"$port" >/dev/null 2>&1; do
        port=$((port + 1))
    done
    echo "$port"
}

set -e  # Exit on error

DEFAULT_BACKEND_PORT=8000
DEFAULT_FRONTEND_PORT=5173

BACKEND_PORT=${BACKEND_PORT:-$(find_free_port $DEFAULT_BACKEND_PORT)}
FRONTEND_PORT=${FRONTEND_PORT:-$(find_free_port $DEFAULT_FRONTEND_PORT)}

export BACKEND_PORT FRONTEND_PORT

echo "👑 ChessTutor - Starting Backend & Frontend..."

# Create and activate virtual environment for backend if needed
cd backend
if [ ! -d ".venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv .venv
    echo "🔧 Installing dependencies..."
    .venv/bin/pip install -r requirements.txt
fi

# Start backend in background
echo "🚀 Starting Backend on http://localhost:$BACKEND_PORT"
BACKEND_PORT=$BACKEND_PORT .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

cd ../frontend

# Check if frontend is already running
if lsof -i :"$FRONTEND_PORT" >/dev/null 2>&1; then
    echo "⚠️  Frontend already running on port $FRONTEND_PORT, skipping..."
else
    echo "🎨 Starting Frontend on http://localhost:$FRONTEND_PORT"
    VITE_API_URL="http://192.168.2.115:$BACKEND_PORT" npm run dev &
    FRONTEND_PID=$!
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ChessTutor is running!"
echo "═══════════════════════════════════════════════════"
echo "  Backend:  http://localhost:$BACKEND_PORT"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

sleep 1

echo "🌐 Opening browser..."
xdg-open "http://localhost:${FRONTEND_PORT}" &

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping ChessTutor services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    echo "✅ Services stopped."
    exit 0
}

# Trap Ctrl+C
trap cleanup SIGINT SIGTERM

# Wait for background processes to finish
wait
