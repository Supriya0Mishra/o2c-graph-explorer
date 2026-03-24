"""
main.py - FastAPI application for the SAP O2C Graph Query System.
"""

import os
from pathlib import Path
from contextlib import asynccontextmanager
from functools import lru_cache

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ingest import run_ingest, get_schema, DATA_DIR, DB_PATH
from graph import build_graph, get_node_neighbors
from llm import run_query

# ── Cached graph (rebuilt after ingest) ───────────────────────────────────
_graph_cache = None

def get_graph():
    global _graph_cache
    if _graph_cache is None:
        _graph_cache = build_graph()
    return _graph_cache

def invalidate_graph():
    global _graph_cache
    _graph_cache = None

# ── App lifecycle ──────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Ingesting data...")
    run_ingest()
    invalidate_graph()
    print("Ready.")
    yield

app = FastAPI(title="SAP O2C Graph Query System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API Routes ─────────────────────────────────────────────────────────────

@app.get("/api/graph")
def api_graph():
    """Return the full graph (nodes + edges + stats)."""
    return get_graph()

@app.get("/api/graph/node/{node_id:path}")
def api_node_neighbors(node_id: str):
    """Return a node and its direct neighbours."""
    try:
        return get_node_neighbors(node_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/api/schema")
def api_schema():
    """Return table schemas."""
    return get_schema()

@app.get("/api/stats")
def api_stats():
    g = get_graph()
    return {
        "nodes": len(g["nodes"]),
        "edges": len(g["edges"]),
        "by_type": g["stats"],
    }


class ChatRequest(BaseModel):
    question: str
    history: list[dict] = []  # [{"role": "user"|"assistant", "content": "..."}]

@app.post("/api/chat")
def api_chat(req: ChatRequest):
    """Natural language query → SQL → answer."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Empty question")
    result = run_query(req.question)
    return result

@app.get("/api/health")
def health():
    return {"status": "ok", "db": str(DB_PATH.exists())}

# ── Serve React frontend (for production) ─────────────────────────────────
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(status_code=404)
