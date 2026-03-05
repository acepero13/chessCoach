#!/bin/bash

# ChessTutor - Start both backend and frontend

set -e  # Exit on error

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
echo "🚀 Starting Backend on http://localhost:8000"
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

cd ../frontend

# Check if frontend is already running
if lsof -i :5173 >/dev/null 2>&1; then
    echo "⚠️  Frontend already running on port 5173, skipping..."
else
    echo "🎨 Starting Frontend on http://localhost:5173"
    npm run dev &
    FRONTEND_PID=$!
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ChessTutor is running!"
echo "═══════════════════════════════════════════════════"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping ChessTutor services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    echo "✅ Services stopped."
    exit 0
}

# Trap Ctrl+C
trap cleanup SIGINT SIGTERM

# Wait for background processes to finish
wait
