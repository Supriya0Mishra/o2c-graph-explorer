# O2C Graph Explorer

A full-stack application for exploring SAP Order-to-Cash (O2C) data as an interactive graph, with a natural-language query interface that translates questions into SQL.

I built this to make a business process that spans many tables (sales orders, deliveries, billing documents, journal entries) easy to trace end to end, without writing the joins by hand each time.

## Features

- **Data ingestion**: loads partitioned JSONL exports (49 files, 17 entity types, 21K+ records) into SQLite, detecting each file's entity type automatically.
- **Graph view**: builds a graph of about 760 nodes and 1,300 edges across 9 entity types, rendered as an interactive force-directed graph with expand, filter and search.
- **Natural-language queries**: questions are translated to SQL, executed against the database, and answered in plain English with the SQL shown.
- **Guardrails**: off-topic questions are rejected before they reach the model.

## Tech stack

| Layer | Technology |
| --- | --- |
| Backend | Python 3.11, FastAPI, Pydantic, httpx |
| Database | SQLite |
| LLM | Llama 3.3 70B via the Groq API |
| Frontend | React 18, Vite, Tailwind CSS, react-force-graph-2d |
| Deployment | Render |

## Architecture

```
JSONL files
    |
    v  ingest.py   detects entity type from filename and keys
SQLite (o2c.db)
    |
    |--> graph.py  builds the in-memory graph (nodes, edges)
    |
    '--> llm.py    natural language -> SQL -> answer
    |
FastAPI (main.py)
    |
React frontend
    |-- GraphPanel  interactive graph
    '-- ChatPanel   query interface
```

## REST API

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/graph` | Full graph (nodes and edges) |
| GET | `/api/graph/node/{node_id}` | Details and neighbours of one node |
| GET | `/api/schema` | Database schema |
| GET | `/api/stats` | Record counts per entity |
| POST | `/api/chat` | Ask a question in natural language |
| GET | `/api/health` | Health check |

## Data model: the O2C join chain

The link between documents is not obvious from the column names. Working it out from the data:

```
sales_order.salesOrder
    v  delivery_item.referenceSdDocument
delivery_item.deliveryDocument
    v  billing_document_item.referenceSdDocument
billing_document.billingDocument
    v  journal_entry_item.referenceDocument
journal_entry_item.accountingDocument
```

`billing_document_item.referenceSdDocument` points to the delivery document, not the sales order. I found this by cross-referencing ID ranges across tables.

## Design decisions

**SQLite over a graph database.** The dataset is well under a million rows, and most questions are aggregations and joins, which SQL handles well. SQLite needs no server and deploys as a single file. The graph is built in memory on top of it and is used only for visualisation.

**Two-stage LLM pipeline.**

1. *SQL generation* at low temperature. The prompt contains the real schema and the join chain, and the model returns JSON with the SQL and its intent.
2. *Answer formatting*. The model receives the question, the SQL and the first 25 result rows, and writes a short answer that cites specific values.

**Three layers of guardrails.**

1. A regex blocklist for clearly off-topic requests.
2. An allowlist of about 50 domain keywords; a question must contain at least one.
3. The model only sees real table definitions, so it cannot invent entities.

## Running locally

Backend:

```bash
cd backend
pip install -r requirements.txt
export GROQ_API_KEY=your_key_here
uvicorn main:app --reload --port 8000
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The app runs at http://localhost:5173. Data files go in `backend/data/`.

## Deployment

`render.yaml` defines a single Render web service that builds the frontend and serves it from the FastAPI app. Set `GROQ_API_KEY` in the Render dashboard.

## Example questions

| Question | Query type |
| --- | --- |
| Which products appear in the most billing documents? | Aggregation |
| Trace the full flow of billing document 90504219 | Multi-table join |
| Find sales orders delivered but never billed | Gap analysis |
| Total invoice value per customer | Group by |
| Which plants handle the most deliveries? | Cross-entity |
