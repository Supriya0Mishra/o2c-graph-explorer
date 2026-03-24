"""
ingest.py - Ingest all SAP O2C JSONL files into SQLite.
Covers all 19 entity types from sap-o2c-data.
"""

import json
import sqlite3
import re
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
DB_PATH  = Path(__file__).parent / "o2c.db"

FILENAME_PATTERNS = [
    ("billing_document_cancellations",          "billing_document_cancellation"),
    ("billing_document_items",                  "billing_document_item"),
    ("billing_document_headers",                "billing_document"),
    ("business_partner_addresses",              "business_partner_address"),
    ("business_partners",                       "business_partner"),
    ("customer_company_assignments",            "customer_company_assignment"),
    ("customer_sales_area_assignments",         "customer_sales_area_assignment"),
    ("journal_entry_items_accounts_receivable", "journal_entry_item"),
    ("journal_entry_items",                     "journal_entry_item"),
    ("outbound_delivery_items",                 "delivery_item"),
    ("outbound_delivery_headers",               "delivery"),
    ("payments_accounts_receivable",            "payment"),
    ("plants",                                  "plant"),
    ("product_descriptions",                    "product_description"),
    ("product_plants",                          "product_plant"),
    ("product_storage_locations",               "product_storage_location"),
    ("products",                                "product"),
    ("sales_order_items",                       "sales_order_item"),
    ("sales_order_schedule_lines",              "sales_order_schedule_line"),
    ("sales_order_headers",                     "sales_order"),
]

# KEY_RULES: check most-specific conditions FIRST
KEY_RULES = [
    # Journal entry: has glAccount (GL line) 
    ("journal_entry_item",            lambda k: "glAccount" in k and "accountingDocument" in k),
    # Payment: has clearingDate or clearingAccountingDocument but no glAccount
    ("payment",                       lambda k: ("clearingDate" in k or "clearingAccountingDocument" in k) and "glAccount" not in k),
    # Billing cancellation: has cancelledBillingDocument
    ("billing_document_cancellation", lambda k: "cancelledBillingDocument" in k and "billingDocumentType" not in k),
    # Billing item: has billingDocumentItem + material
    ("billing_document_item",         lambda k: "billingDocumentItem" in k and "material" in k),
    # Billing header: has billingDocumentType
    ("billing_document",              lambda k: "billingDocument" in k and "billingDocumentType" in k),
    # SO schedule line
    ("sales_order_schedule_line",     lambda k: "scheduleLine" in k and "salesOrder" in k),
    # SO item
    ("sales_order_item",              lambda k: "salesOrderItem" in k and "salesOrder" in k),
    # SO header
    ("sales_order",                   lambda k: "salesOrder" in k and "salesOrderType" in k),
    # Delivery item
    ("delivery_item",                 lambda k: "deliveryDocumentItem" in k),
    # Delivery header
    ("delivery",                      lambda k: "deliveryDocument" in k and "deliveryDocumentItem" not in k),
    # Product storage location
    ("product_storage_location",      lambda k: "storageLocation" in k and "product" in k),
    # Product plant
    ("product_plant",                 lambda k: "product" in k and "plant" in k and "storageLocation" not in k and "productDescription" not in k and "baseUnit" not in k),
    # Product description
    ("product_description",           lambda k: "productDescription" in k),
    # Product master
    ("product",                       lambda k: "product" in k and "baseUnit" in k),
    # Plant master
    ("plant",                         lambda k: "plant" in k and ("plantName" in k or "valuationArea" in k) and "product" not in k),
    # Business partner address
    ("business_partner_address",      lambda k: "businessPartner" in k and ("cityName" in k or "streetName" in k or "addressId" in k)),
    # Business partner
    ("business_partner",              lambda k: "businessPartner" in k and ("businessPartnerFullName" in k or "businessPartnerCategory" in k)),
    # Customer sales area
    ("customer_sales_area_assignment",lambda k: "customer" in k and ("salesOrganization" in k or "distributionChannel" in k) and "companyCode" not in k),
    # Customer company
    ("customer_company_assignment",   lambda k: "customer" in k and "companyCode" in k and "accountingDocument" not in k),
]

def detect_from_filename(fname):
    lower = fname.lower()
    for pattern, table in FILENAME_PATTERNS:
        if pattern in lower:
            return table
    return None

def detect_from_keys(keys):
    for name, rule in KEY_RULES:
        try:
            if rule(keys):
                return name
        except Exception:
            continue
    return "unknown"

def flatten(record, prefix=""):
    out = {}
    for k, v in record.items():
        col = f"{prefix}{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, prefix=f"{col}_"))
        elif isinstance(v, list):
            out[col] = json.dumps(v)
        else:
            out[col] = v
    return out

def sanitize_col(name):
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)

def ingest_file(conn, path):
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    if not records:
        return ("empty", 0)

    entity = detect_from_filename(path.name) or detect_from_keys(set(records[0].keys()))
    flat_records = [flatten(r) for r in records]

    all_cols = set()
    for r in flat_records:
        all_cols.update(r.keys())
    cols = sorted(all_cols)
    safe_cols = [sanitize_col(c) for c in cols]
    col_map = dict(zip(cols, safe_cols))

    col_defs = ", ".join(f'"{c}" TEXT' for c in safe_cols)
    conn.execute(f'CREATE TABLE IF NOT EXISTS "{entity}" ({col_defs})')
    existing = {row[1] for row in conn.execute(f'PRAGMA table_info("{entity}")')}
    for sc in safe_cols:
        if sc not in existing:
            conn.execute(f'ALTER TABLE "{entity}" ADD COLUMN "{sc}" TEXT')

    for r in flat_records:
        row = {col_map[k]: v for k, v in r.items()}
        placeholders = ", ".join("?" for _ in row)
        col_names = ", ".join(f'"{c}"' for c in row.keys())
        conn.execute(
            f'INSERT INTO "{entity}" ({col_names}) VALUES ({placeholders})',
            list(row.values())
        )
    return (entity, len(records))

def run_ingest(data_dir=DATA_DIR, db_path=DB_PATH):
    if Path(db_path).exists():
        Path(db_path).unlink()
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    summary = {}
    files = sorted(Path(data_dir).glob("*.jsonl"))
    print(f"Found {len(files)} JSONL files")
    for fpath in files:
        entity, count = ingest_file(conn, fpath)
        summary[entity] = summary.get(entity, 0) + count
        print(f"  {fpath.name[:58]:<58} -> {entity} ({count} rows)")
    conn.commit()
    conn.close()
    print(f"\nSummary: {summary}")
    return summary

def get_schema(db_path=DB_PATH):
    conn = sqlite3.connect(db_path)
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )]
    schema = {}
    for t in tables:
        cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')]
        count = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        schema[t] = {"columns": cols, "rows": count}
    conn.close()
    return schema

if __name__ == "__main__":
    run_ingest()
