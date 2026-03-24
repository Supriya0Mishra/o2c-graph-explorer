#!/bin/bash
set -e

echo "=== SAP O2C Graph Explorer ==="

# Check GEMINI_API_KEY
if [ -z "$GEMINI_API_KEY" ]; then
  echo "ERROR: Please set GEMINI_API_KEY"
  echo "  export GEMINI_API_KEY=your_key_here"
  exit 1
fi

# Backend
echo "Starting backend..."
cd backend
pip install -r requirements.txt -q
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Frontend
echo "Starting frontend..."
cd frontend
npm install --silent
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Backend:  http://localhost:8000"
echo "✅ Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop."
wait
