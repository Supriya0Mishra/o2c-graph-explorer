"""
llm.py — Groq-powered NL→SQL pipeline with guardrails.
Uses llama-3.3-70b-versatile via Groq (fast, free, no rate limits)
"""

import os, json, re, sqlite3, httpx
from pathlib import Path

DB_PATH = Path(__file__).parent / "o2c.db"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

DOMAIN_KEYWORDS = {
    "order","orders","sales","billing","invoice","invoices","delivery","deliveries",
    "payment","payments","journal","customer","customers","material","materials",
    "product","products","plant","plants","partner","document","documents",
    "amount","quantity","qty","net","total","billed","delivered","cancelled",
    "revenue","item","items","flow","shipment","address","fiscal","accounting",
    "schedule","storage","company","assignment","trace","find","show","list",
    "count","top","highest","lowest","broken","incomplete","missing","everything",
    "status","value","date","period","region","area",
}

OFF_TOPIC = [
    r"\bwrite\s+(a\s+)?(poem|story|essay|song|email)\b",
    r"\bwho\s+is\s+[A-Z][a-z]+\s+[A-Z]",
    r"\bweather\b",r"\bjoke\b",r"\brecipe\b",r"\btranslate\b",
    r"\bcapital\s+of\b",r"\bwikipedia\b",
]

def is_on_topic(q: str) -> bool:
    ql = q.lower()
    for p in OFF_TOPIC:
        if re.search(p, ql): return False
    return bool(set(re.findall(r"\b\w+\b", ql)) & DOMAIN_KEYWORDS)

def get_schema_text(db_path=DB_PATH) -> str:
    conn = sqlite3.connect(db_path)
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    lines = []
    for t in tables:
        cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')]
        cnt  = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        lines.append(f'TABLE "{t}" ({cnt} rows): {", ".join(cols)}')
    conn.close()
    return "\n".join(lines)

def _groq(system: str, user: str) -> str:
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY not set.")
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "temperature": 0.05,
        "max_tokens": 2048,
    }
    r = httpx.post(GROQ_URL, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

SQL_SYSTEM = """You are a SQL expert for an SAP Order-to-Cash SQLite database.

CRITICAL JOIN CHAIN:
  sales_order_item.salesOrder = delivery_item.referenceSdDocument
  delivery_item.deliveryDocument = billing_document_item.referenceSdDocument
  billing_document_item.billingDocument = billing_document.billingDocument
  billing_document.billingDocument = journal_entry_item.referenceDocument
  billing_document.soldToParty = business_partner.businessPartner
  billing_document_item.material = product_description.product

RULES:
- Output ONLY a JSON object: {"sql":"<query>","intent":"<one sentence>"}
- Use exact camelCase column names from the schema.
- LIMIT 100 for list queries; no limit for aggregations.
- For "full flow" or "trace" queries use the join chain above.
- For gap analysis use LEFT JOIN ... WHERE right.col IS NULL.
- NEVER output markdown, backticks, or explanation. Only the JSON object.
- If unanswerable from schema, return {"sql":null,"intent":"explanation"}.
"""

ANSWER_SYSTEM = """You are a sharp SAP business analyst. Given a question and SQL results, write a crisp answer:
- 2-5 sentences maximum.
- Lead with the key finding or number.
- Cite specific IDs, amounts, or counts from the results.
- If results are empty, say so and explain what that implies.
- Be professional. Do not mention SQL or technical details.
"""

def run_query(question: str, db_path=DB_PATH) -> dict:
    if not is_on_topic(question):
        return {
            "answer": "This system answers questions about the SAP Order-to-Cash dataset only — "
                      "sales orders, deliveries, invoices, journal entries, customers, and products.",
            "sql": None, "rows": [], "blocked": True, "error": None,
        }

    schema = get_schema_text(db_path)

    # Step 1: Generate SQL
    try:
        raw = _groq(SQL_SYSTEM, f"Schema:\n{schema}\n\nQuestion: {question}")
        raw = re.sub(r"```[a-z]*", "", raw).strip().strip("`").strip()
        # Extract JSON even if there's extra text
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            raw = match.group(0)
        parsed = json.loads(raw)
        sql = parsed.get("sql")
        intent = parsed.get("intent", "")
    except Exception as e:
        return {"answer": f"Failed to generate query: {e}", "sql": None,
                "rows": [], "blocked": False, "error": str(e)}

    if not sql:
        return {"answer": intent, "sql": None, "rows": [], "blocked": False, "error": None}

    # Step 2: Execute SQL
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = [dict(r) for r in conn.execute(sql).fetchall()]
        conn.close()
    except Exception as e:
        return {"answer": f"Query error: {e}", "sql": sql,
                "rows": [], "blocked": False, "error": str(e)}

    # Step 3: Format answer
    preview = json.dumps(rows[:25], indent=2)
    try:
        answer = _groq(
            ANSWER_SYSTEM,
            f"Question: {question}\nSQL: {sql}\nResults ({len(rows)} total rows):\n{preview}"
        )
    except Exception as e:
        answer = f"Found {len(rows)} results. (Formatting failed: {e})"

    return {"answer": answer, "sql": sql, "rows": rows[:100], "blocked": False, "error": None}