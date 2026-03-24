# SAP O2C Graph Explorer

An interactive knowledge graph + LLM-powered query interface for SAP Order-to-Cash data.

**Live Demo:** [Add Render URL after deploy]  
**GitHub:** [Your repo URL]

---

## What It Does

- Ingests raw SAP O2C JSONL exports (17 entity types, 21K+ records)
- Constructs a **knowledge graph** of business relationships
- Visualises it interactively — click, expand, filter, search
- Lets users ask **natural language questions** which are translated to SQL, executed, and answered in plain English
- Strictly **guardrailed** to the dataset domain

---

## Architecture

```
JSONL Files (49 partitioned files, 17 entity types)
    │
    ▼  ingest.py (auto-detects entity type via filename + key heuristics)
SQLite DB (o2c.db)  ←── zero-config, file-based, full SQL analytics
    │
    ├──► graph.py    — builds NetworkX-style graph in memory
    │                  760 nodes, 1,300 edges across 9 entity types
    │
    └──► llm.py      — Gemini 1.5 Flash NL→SQL pipeline
                       schema-aware prompt + guardrails
    │
FastAPI backend  (/api/graph  /api/chat  /api/stats  /api/schema)
    │
React frontend  (react-force-graph-2d + custom dark UI)
    ├── Graph Panel  — interactive force-directed graph
    └── Chat Panel   — conversational query interface
```

---

## Discovered O2C Join Chain

Reverse-engineered from the actual data (non-obvious):

```
sales_order.salesOrder
    ↓  (via delivery_item.referenceSdDocument)
delivery_item.deliveryDocument
    ↓  (via billing_document_item.referenceSdDocument)
billing_document.billingDocument
    ↓  (via journal_entry_item.referenceDocument)
journal_entry_item.accountingDocument
```

Key insight: `billing_document_item.referenceSdDocument` points to the **delivery document**, NOT the sales order. This was discovered by cross-referencing ID ranges across tables.

---

## Database Choice: SQLite

Chosen over Neo4j / PostgreSQL because:

| Criterion | SQLite | Neo4j |
|---|---|---|
| Setup | Zero — file-based | Server required |
| SQL analytics | Full ANSI SQL | Cypher (limited aggregations) |
| Dataset size | Perfect for <1M rows | Overkill |
| Portability | Single `.db` file | Complex config |
| Free tier deploy | ✅ | ❌ |

The graph layer (in-memory Python dict) sits on top of SQLite for visualisation. SQL does the heavy querying; the graph provides exploration UX.

---

## LLM Prompting Strategy

**Two-stage pipeline:**

**Stage 1 — SQL Generation** (temp=0.05, deterministic):
- System prompt includes full schema + the correct join chain
- Instructed to output only `{"sql":"...", "intent":"..."}`
- Strips markdown fences before JSON parsing

**Stage 2 — Answer Formatting** (temp=0.1):
- Receives question + SQL + top-25 result rows
- Instructed to cite specific values, lead with the key finding, stay ≤5 sentences

---

## Guardrails (3 layers)

1. **Regex blocklist** — rejects: `write a poem`, `who is <person>`, `weather`, `joke`, `recipe`, `translate`
2. **Domain keyword allowlist** — query must contain at least one of ~50 O2C domain words
3. **Schema-scoped SQL** — LLM only sees real table definitions; cannot fabricate entities

Response: `"This system answers questions about the SAP Order-to-Cash dataset only."`

---

## Local Setup

```bash
# Clone
git clone <repo>
cd dodge-ai-task

# Backend
cd backend
pip install -r requirements.txt
export GEMINI_API_KEY=your_key_here   # https://ai.google.dev
uvicorn main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev   # → http://localhost:5173
```

Add data files to `backend/data/` — the system auto-detects entity types.

---

## Deploy to Render

1. Push to GitHub
2. New Web Service → connect repo
3. **Build:** `pip install -r backend/requirements.txt && cd frontend && npm install && npm run build`
4. **Start:** `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **Env var:** `GEMINI_API_KEY=your_key`

---

## Example Queries the System Handles

| Query | Type |
|---|---|
| "Which products appear in the most billing documents?" | Aggregation |
| "Trace the full flow of billing document 90504219" | Multi-table join |
| "Find sales orders delivered but never billed" | Gap analysis |
| "Total invoice value per customer" | Group-by |
| "Which plants handle the most deliveries?" | Cross-entity |
| "Tell me everything about customer 320000083" | Entity deep-dive |
