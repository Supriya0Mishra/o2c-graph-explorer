"""
graph.py - Build graph dict from SQLite O2C data.

Correct O2C join chain discovered from data:
  sales_order_item.salesOrder
      -> delivery_item.referenceSdDocument (= salesOrder via SO item)
      -> delivery_item.deliveryDocument
      -> billing_document_item.referenceSdDocument (= deliveryDocument)
      -> billing_document_item.billingDocument
      -> journal_entry_item.referenceDocument (= billingDocument)
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "o2c.db"

NODE_COLORS = {
    "billing_document":         "#6366f1",
    "billing_document_item":    "#8b5cf6",
    "sales_order":              "#0ea5e9",
    "sales_order_item":         "#38bdf8",
    "delivery":                 "#10b981",
    "delivery_item":            "#34d399",
    "customer":                 "#f59e0b",
    "product":                  "#ef4444",
    "plant":                    "#84cc16",
    "journal_entry_item":       "#ec4899",
    "payment":                  "#14b8a6",
    "unknown":                  "#94a3b8",
}

def _conn(db_path=DB_PATH):
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    return c

def _tables(conn):
    return {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}

def build_graph(db_path=DB_PATH) -> dict:
    conn = _conn(db_path)
    tables = _tables(conn)
    nodes = {}
    edges = []
    edge_set = set()

    def add_node(nid, ntype, label, meta):
        if nid not in nodes:
            nodes[nid] = {
                "id":    nid,
                "type":  ntype,
                "label": label,
                "color": NODE_COLORS.get(ntype, NODE_COLORS["unknown"]),
                "meta":  {k: str(v) for k, v in meta.items()
                          if v not in (None, "", "None", "null")},
            }

    def add_edge(src, tgt, rel):
        key = (src, tgt, rel)
        if key not in edge_set and src in nodes and tgt in nodes:
            edge_set.add(key)
            edges.append({"source": src, "target": tgt, "relation": rel})

    # ── Customers (Business Partners) ─────────────────────────────────
    if "business_partner" in tables:
        for row in conn.execute('SELECT * FROM "business_partner"'):
            r = dict(row)
            bp = r.get("businessPartner", "")
            if not bp: continue
            add_node(f"CUST:{bp}", "customer",
                     r.get("businessPartnerFullName") or f"Customer {bp}", {
                "ID": bp,
                "Name": r.get("businessPartnerFullName", ""),
                "Category": r.get("businessPartnerCategory", ""),
            })

    if "business_partner_address" in tables:
        for row in conn.execute('SELECT * FROM "business_partner_address"'):
            r = dict(row)
            bp = r.get("businessPartner", "")
            if not bp: continue
            nid = f"CUST:{bp}"
            addr = f"{r.get('streetName','')}, {r.get('cityName','')}, {r.get('region','')}"
            if nid not in nodes:
                add_node(nid, "customer", f"Customer {bp}", {"ID": bp})
            nodes[nid]["meta"]["Address"] = addr
            nodes[nid]["meta"]["Country"] = r.get("country", "")

    # ── Products ──────────────────────────────────────────────────────
    desc_map = {}
    if "product_description" in tables:
        for row in conn.execute('SELECT product, productDescription FROM "product_description"'):
            r = dict(row)
            if r.get("product") and r.get("productDescription"):
                desc_map[r["product"]] = r["productDescription"]

    if "product" in tables:
        for row in conn.execute('SELECT * FROM "product"'):
            r = dict(row)
            pid = r.get("product", "")
            if not pid: continue
            desc = desc_map.get(pid, "")
            add_node(f"PROD:{pid}", "product",
                     desc[:28] if desc else f"Product {pid}", {
                "Product ID": pid,
                "Description": desc,
                "Type": r.get("productType", ""),
                "Base Unit": r.get("baseUnit", ""),
            })
    else:
        # Synthesize product nodes from descriptions
        for pid, desc in desc_map.items():
            add_node(f"PROD:{pid}", "product",
                     desc[:28] if desc else f"Product {pid}", {
                "Product ID": pid, "Description": desc,
            })

    # ── Plants ────────────────────────────────────────────────────────
    if "plant" in tables:
        for row in conn.execute('SELECT * FROM "plant"'):
            r = dict(row)
            pl = r.get("plant", "")
            if not pl: continue
            add_node(f"PLANT:{pl}", "plant",
                     r.get("plantName") or f"Plant {pl}", {
                "Plant": pl,
                "Name": r.get("plantName", ""),
                "Country": r.get("country", ""),
            })

    # ── Sales Orders ──────────────────────────────────────────────────
    if "sales_order" in tables:
        for row in conn.execute('SELECT * FROM "sales_order"'):
            r = dict(row)
            so = r.get("salesOrder", "")
            if not so: continue
            so_nid = f"SO:{so}"
            add_node(so_nid, "sales_order", f"SO {so}", {
                "Sales Order": so,
                "Type": r.get("salesOrderType", ""),
                "Customer": r.get("soldToParty", ""),
                "Date": (r.get("salesOrderDate", "") or "")[:10],
            })
            cid = r.get("soldToParty", "")
            if cid:
                cnid = f"CUST:{cid}"
                if cnid not in nodes:
                    add_node(cnid, "customer", f"Customer {cid}", {"ID": cid})
                add_edge(so_nid, cnid, "SOLD_TO")

    if "sales_order_item" in tables:
        for row in conn.execute('SELECT * FROM "sales_order_item"'):
            r = dict(row)
            so = r.get("salesOrder", "")
            item = r.get("salesOrderItem", "")
            mat = r.get("material", "")
            if not so or not item: continue
            item_nid = f"SOI:{so}-{item}"
            add_node(item_nid, "sales_order_item", f"SO {so} / Item {item}", {
                "Sales Order": so, "Item": item,
                "Material": mat,
                "Qty": f"{r.get('requestedQuantity','')} {r.get('requestedQuantityUnit','')}",
                "Net Amount": f"{r.get('netAmount','')} {r.get('transactionCurrency','')}",
            })
            so_nid = f"SO:{so}"
            if so_nid not in nodes:
                add_node(so_nid, "sales_order", f"SO {so}", {"Sales Order": so})
            add_edge(so_nid, item_nid, "HAS_ITEM")
            if mat:
                mat_nid = f"PROD:{mat}"
                if mat_nid not in nodes:
                    add_node(mat_nid, "product", f"Product {mat}", {"Product ID": mat})
                add_edge(item_nid, mat_nid, "FOR_PRODUCT")

    # ── Deliveries ────────────────────────────────────────────────────
    if "delivery" in tables:
        for row in conn.execute('SELECT * FROM "delivery"'):
            r = dict(row)
            dno = r.get("deliveryDocument", "")
            if not dno: continue
            add_node(f"DLV:{dno}", "delivery", f"Delivery {dno}", {
                "Delivery": dno,
                "Goods Movement": (r.get("actualGoodsMovementDate", "") or "")[:10],
                "Status": r.get("overallGoodsMovementStatus", ""),
                "Picking": r.get("overallPickingStatus", ""),
            })

    if "delivery_item" in tables:
        for row in conn.execute('SELECT * FROM "delivery_item"'):
            r = dict(row)
            dno = r.get("deliveryDocument", "")
            so_ref = r.get("referenceSdDocument", "")   # = salesOrder
            plant = r.get("plant", "")
            if not dno: continue

            dnid = f"DLV:{dno}"
            if dnid not in nodes:
                add_node(dnid, "delivery", f"Delivery {dno}", {"Delivery": dno})

            # Delivery -> Sales Order
            if so_ref:
                so_nid = f"SO:{so_ref}"
                if so_nid not in nodes:
                    add_node(so_nid, "sales_order", f"SO {so_ref}", {"Sales Order": so_ref})
                add_edge(dnid, so_nid, "FULFILLS")

            # Delivery -> Plant
            if plant:
                pl_nid = f"PLANT:{plant}"
                if pl_nid not in nodes:
                    add_node(pl_nid, "plant", f"Plant {plant}", {"Plant": plant})
                add_edge(dnid, pl_nid, "SHIPS_FROM")

    # ── Billing Documents ─────────────────────────────────────────────
    if "billing_document" in tables:
        for row in conn.execute('SELECT * FROM "billing_document"'):
            r = dict(row)
            bid = r.get("billingDocument", "")
            if not bid: continue
            bd_nid = f"BD:{bid}"
            add_node(bd_nid, "billing_document", f"Invoice {bid}", {
                "Billing Doc": bid,
                "Type": r.get("billingDocumentType", ""),
                "Date": (r.get("billingDocumentDate", "") or "")[:10],
                "Amount": f"{r.get('totalNetAmount','')} {r.get('transactionCurrency','')}",
                "Cancelled": r.get("billingDocumentIsCancelled", ""),
                "Customer": r.get("soldToParty", ""),
                "Acctg Doc": r.get("accountingDocument", ""),
            })
            cid = r.get("soldToParty", "")
            if cid:
                cnid = f"CUST:{cid}"
                if cnid not in nodes:
                    add_node(cnid, "customer", f"Customer {cid}", {"ID": cid})
                add_edge(bd_nid, cnid, "BILLED_TO")

    if "billing_document_item" in tables:
        for row in conn.execute('SELECT * FROM "billing_document_item"'):
            r = dict(row)
            bid = r.get("billingDocument", "")
            item = r.get("billingDocumentItem", "")
            mat = r.get("material", "")
            dlv_ref = r.get("referenceSdDocument", "")   # = deliveryDocument
            if not bid: continue

            bd_nid = f"BD:{bid}"
            if bd_nid not in nodes:
                add_node(bd_nid, "billing_document", f"Invoice {bid}", {"Billing Doc": bid})

            # Billing -> Delivery (via referenceSdDocument = deliveryDocument)
            if dlv_ref:
                dlv_nid = f"DLV:{dlv_ref}"
                if dlv_nid not in nodes:
                    add_node(dlv_nid, "delivery", f"Delivery {dlv_ref}", {"Delivery": dlv_ref})
                add_edge(bd_nid, dlv_nid, "BILLED_FROM")

            # Billing -> Product
            if mat:
                mat_nid = f"PROD:{mat}"
                if mat_nid not in nodes:
                    add_node(mat_nid, "product", f"Product {mat}", {"Product ID": mat})
                add_edge(bd_nid, mat_nid, "INCLUDES")

    # ── Journal Entry Items ───────────────────────────────────────────
    if "journal_entry_item" in tables:
        for row in conn.execute('SELECT * FROM "journal_entry_item"'):
            r = dict(row)
            doc = r.get("accountingDocument", "")
            ref = r.get("referenceDocument", "")   # = billingDocument
            if not doc: continue
            je_nid = f"JE:{doc}"
            if je_nid not in nodes:
                add_node(je_nid, "journal_entry_item", f"JE {doc}", {
                    "Acctg Doc": doc,
                    "Company": r.get("companyCode", ""),
                    "Year": r.get("fiscalYear", ""),
                    "GL Account": r.get("glAccount", ""),
                    "Amount": f"{r.get('amountInTransactionCurrency','')} {r.get('transactionCurrency','')}",
                    "Posting Date": (r.get("postingDate", "") or "")[:10],
                })
            # JE -> Billing Document
            if ref:
                bd_nid = f"BD:{ref}"
                if bd_nid in nodes:
                    add_edge(bd_nid, je_nid, "POSTED_TO")

    conn.close()

    type_stats = {}
    for n in nodes.values():
        type_stats[n["type"]] = type_stats.get(n["type"], 0) + 1

    return {"nodes": list(nodes.values()), "edges": edges, "stats": type_stats}


def get_node_neighbors(node_id, db_path=DB_PATH):
    full = build_graph(db_path)
    neighbor_ids = {node_id}
    relevant_edges = []
    for e in full["edges"]:
        if e["source"] == node_id or e["target"] == node_id:
            neighbor_ids.add(e["source"])
            neighbor_ids.add(e["target"])
            relevant_edges.append(e)
    return {
        "nodes": [n for n in full["nodes"] if n["id"] in neighbor_ids],
        "edges": relevant_edges,
    }
