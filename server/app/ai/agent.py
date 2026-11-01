import os
import re
import json
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_google_genai import ChatGoogleGenerativeAI
from app.db.database import tickets_collection, work_orders_collection

# --- SHARED STATE FOR MULTI-AGENT COLLABORATION ---
class NLPGraphState(TypedDict):
    command: str
    intent: dict
    route: str  
    requires_approval: bool
    pending_target: str
    target_type: str
    reply: str
    tickets: list
    workOrders: list

def serialize_doc(doc: dict) -> dict:
    clean = {}
    for k, v in doc.items():
        if k == "_id":
            clean[k] = str(v)
        elif hasattr(v, "isoformat"):
            clean[k] = v.isoformat()
        else:
            clean[k] = v
    return clean

def normalize_ticket_status(status: str | None) -> str | None:
    if not status:
        return None
    s = status.strip().upper().replace(" ", "_")
    mapping = {
        "ACTIVE": "OPEN", "OPEN": "OPEN", "NEW": "OPEN", "PENDING": "OPEN",
        "IN_PROGRESS": "IN_PROGRESS", "INPROGRESS": "IN_PROGRESS", "WORKING": "IN_PROGRESS",
        "RESOLVED": "RESOLVED", "CLOSED": "RESOLVED", "DONE": "RESOLVED", "COMPLETED": "RESOLVED"
    }
    return mapping.get(s, None)

def normalize_wo_status(status: str | None) -> str | None:
    if not status:
        return None
    s = status.strip().upper().replace(" ", "_")
    mapping = {
        "APPROVED": "APPROVED", "OPEN": "APPROVED", "TO_DO": "APPROVED", "TODO": "APPROVED",
        "IN_PROGRESS": "IN_PROGRESS", "ACTIVE": "IN_PROGRESS", "WORKING": "IN_PROGRESS",
        "COMPLETED": "COMPLETED", "DONE": "COMPLETED", "RESOLVED": "COMPLETED", "CLOSED": "COMPLETED"
    }
    return mapping.get(s, None)

def clean_entity_term(raw: str) -> str:
    return raw.strip().strip("[]\"'.,;:!?() ").strip()

STOPWORDS = {
    "please", "can", "could", "you", "me", "the", "a", "an", "all", "any", "some",
    "list", "show", "get", "find", "see", "fetch", "search", "give", "display", "view",
    "ticket", "tickets", "work", "order", "orders", "item", "items", "fault", "faults",
    "which", "that", "who", "whose", "where", "what", "are", "is", "was", "were", "be",
    "have", "has", "having", "contain", "contains", "containing", "include", "includes",
    "including", "with", "for", "on", "in", "of", "from", "by", "to", "as", "into",
    "assigned", "assign", "reported", "raised", "created", "status", "severity", "priority",
    "machine", "machines", "model", "technician", "tech", "operator", "change", "update",
    "set", "mark", "make", "delete", "remove", "close", "resolve", "approve", "complete",
    "there", "their", "them", "those", "these", "and", "or"
}

# --- DEEP NLP PARSER ---
def extract_structured_intent_deterministic(command: str) -> dict:
    cmd = command.strip()
    lower = cmd.lower()

    is_wo = any(k in lower for k in ["work order", "work orders", "work item", "work items", "wo-"])
    is_ticket = any(k in lower for k in ["ticket", "tickets", "tkt-"])
    
    target = "work_orders" if (is_wo and not is_ticket) or any(k in lower for k in ["assigned", "technician", "priority", "approved"]) else "tickets"
    
    if any(re.search(rf"\b{w}\b", lower) for w in ["delete", "remove"]):
        action = "delete"
    elif any(re.search(rf"\b{w}\b", lower) for w in ["change", "update", "set", "mark", "close", "resolve", "approve", "complete"]):
        action = "update"
    else:
        action = "query"

    intent = {
        "target": target, "action": action, "ticket_id": None, "work_order_id": None,
        "status": None, "new_status": None, "severity": None, "priority": None,
        "assigned_technician": None, "reported_by": None, "machine_model": None,
        "machine_id": None, "fault_code": None, "search_terms": []
    }

    tkt_match = re.search(r"\b(TKT-\d{4}-[A-Za-z0-9]+|TKT-[A-Za-z0-9-]+)\b", cmd, re.I)
    if tkt_match:
        intent["ticket_id"] = tkt_match.group(1).upper()

    wo_match = re.search(r"\b(WO-[A-Za-z0-9-]+)\b", cmd, re.I)
    if wo_match:
        intent["work_order_id"] = wo_match.group(1).upper()

    mach_id_match = re.search(r"\b((?:CNC|TURB|LASER|PRESS|CMM)-[A-Za-z0-9-]+)\b", cmd, re.I)
    if mach_id_match:
        intent["machine_id"] = mach_id_match.group(1).upper()

    for m in re.finditer(r"\[([^\]]+)\]", cmd):
        term = clean_entity_term(m.group(1))
        if term and term not in intent["search_terms"]:
            intent["search_terms"].append(term)

    status_pattern = r"(open|active|in\s+progress|in_progress|resolved|closed|approved|completed|done|to\s+do|todo)"
    if action == "update":
        to_match = re.search(rf"\b(?:to|as|into)\s+{status_pattern}\b", lower)
        if to_match:
            raw_new = to_match.group(1)
            intent["new_status"] = normalize_wo_status(raw_new) if target == "work_orders" else normalize_ticket_status(raw_new)
        elif "close" in lower or "resolve" in lower:
            intent["new_status"] = "COMPLETED" if target == "work_orders" else "RESOLVED"
        
        before_to = lower[:to_match.start()] if to_match else lower
        from_match = re.search(rf"\b{status_pattern}\b", before_to)
        if from_match:
            intent["status"] = normalize_wo_status(from_match.group(1)) if target == "work_orders" else normalize_ticket_status(from_match.group(1))
    else:
        st_match = re.search(rf"\b{status_pattern}\b", lower)
        if st_match:
            intent["status"] = normalize_wo_status(st_match.group(1)) if target == "work_orders" else normalize_ticket_status(st_match.group(1))

    sev_match = re.search(r"\b(critical|high|medium|low)\b", lower)
    if sev_match and target == "tickets":
        intent["severity"] = sev_match.group(1).upper()

    prio_match = re.search(r"\b(p1_urgent|p2_normal|p3_low|p1|p2|p3|urgent|normal)\b", lower)
    if prio_match and target == "work_orders":
        p_raw = prio_match.group(1).upper()
        if "P1" in p_raw or "URGENT" in p_raw:
            intent["priority"] = "P1_URGENT"
        elif "P2" in p_raw or "NORMAL" in p_raw:
            intent["priority"] = "P2_NORMAL"
        elif "P3" in p_raw or "LOW" in p_raw:
            intent["priority"] = "P3_LOW"

    assigned_match = re.search(r"\b(?:assigned\s+to|technician|tech)\s+([A-Za-z][A-Za-z\s.\-]{1,40}?)(?=\s+(?:with|where|which|that|having|in|on|for|and|to|status|priority)\b|$)", cmd, re.I)
    if assigned_match:
        intent["assigned_technician"] = clean_entity_term(assigned_match.group(1))

    reported_match = re.search(r"\b(?:reported\s+by|raised\s+by|created\s+by|operator)\s+([A-Za-z][A-Za-z\s.\-]{1,40}?)(?=\s+(?:with|where|which|that|having|in|on|for|and|to|status|severity)\b|$)", cmd, re.I)
    if reported_match:
        intent["reported_by"] = clean_entity_term(reported_match.group(1))

    for m in re.finditer(r"\b([A-Za-z]+-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\b", cmd):
        token = clean_entity_term(m.group(1))
        upper_tok = token.upper()
        if not upper_tok.startswith("TKT-") and not upper_tok.startswith("WO-") and not upper_tok.startswith("CNC-"):
            if not intent["machine_model"]:
                intent["machine_model"] = token
            if token not in intent["search_terms"]:
                intent["search_terms"].append(token)

    return intent

# --- QUERY BUILDER ---
def build_mongo_filter(intent: dict) -> dict:
    target = intent["target"]
    and_conditions = []

    if target == "tickets":
        if intent.get("ticket_id"):
            and_conditions.append({"ticketId": {"$regex": f"^{re.escape(intent['ticket_id'])}$", "$options": "i"}})
        if intent.get("status"):
            and_conditions.append({"status": intent["status"]})
        if intent.get("severity"):
            and_conditions.append({"severity": intent["severity"].upper()})
        if intent.get("reported_by"):
            and_conditions.append({"reportedBy": {"$regex": re.escape(intent["reported_by"]), "$options": "i"}})
        if intent.get("machine_id"):
            and_conditions.append({"machineId": {"$regex": re.escape(intent["machine_id"]), "$options": "i"}})

        for term in intent.get("search_terms", []):
            rx = {"$regex": re.escape(term), "$options": "i"}
            and_conditions.append({"$or": [{"title": rx}, {"description": rx}, {"machineModel": rx}, {"machineId": rx}]})
    else:
        if intent.get("work_order_id"):
            and_conditions.append({"workOrderId": {"$regex": f"^{re.escape(intent['work_order_id'])}$", "$options": "i"}})
        if intent.get("status"):
            and_conditions.append({"status": intent["status"]})
        if intent.get("priority"):
            and_conditions.append({"priority": {"$regex": re.escape(intent["priority"]), "$options": "i"}})
        if intent.get("assigned_technician"):
            and_conditions.append({"assignedTechnician": {"$regex": re.escape(intent["assigned_technician"]), "$options": "i"}})
        if intent.get("machine_id"):
            and_conditions.append({"machineId": {"$regex": re.escape(intent["machine_id"]), "$options": "i"}})

        for term in intent.get("search_terms", []):
            if intent.get("assigned_technician") and term.lower() == intent["assigned_technician"].lower():
                continue
            rx = {"$regex": re.escape(term), "$options": "i"}
            and_conditions.append({"$or": [{"title": rx}, {"resolutionNotes": rx}, {"machineModel": rx}, {"assignedTechnician": rx}]})

    if not and_conditions:
        return {}
    if len(and_conditions) == 1:
        return and_conditions[0]
    return {"$and": and_conditions}


# --- FAST NLP PIPELINE (Instant MongoDB Execution) ---
async def try_fast_nlp_execution(command: str) -> dict | None:
    intent = extract_structured_intent_deterministic(command)

    # 1. HITL Interceptor for Deletions
    if intent["action"] == "delete":
        t_id = intent.get("work_order_id") if intent["target"] == "work_orders" else intent.get("ticket_id")
        if t_id:
            label = "work order" if intent["target"] == "work_orders" else "ticket"
            return {
                "reply": f"SECURITY HOLD: Human authorization required to delete {label} {t_id}.",
                "tickets": [], "workOrders": [], "requires_approval": True, 
                "pending_target": t_id, "target_type": "wo" if intent["target"] == "work_orders" else "ticket"
            }
        return None

    # 2. Fast Filter Queries (Safely handles None values for status/severity)
    if intent["action"] == "query":
        query = build_mongo_filter(intent)
        status_raw = intent.get("status")
        status_str = f" {status_raw.lower()}" if isinstance(status_raw, str) and status_raw else ""

        if intent["target"] == "tickets":
            docs = [serialize_doc(d) async for d in tickets_collection.find(query).sort("createdAt", -1).limit(50)]
            return {
                "reply": f"Found {len(docs)}{status_str} ticket(s).",
                "tickets": docs,
                "workOrders": [],
                "requires_approval": False
            }
        else:
            docs = [serialize_doc(d) async for d in work_orders_collection.find(query).sort("createdAt", -1).limit(50)]
            return {
                "reply": f"Found {len(docs)}{status_str} work order(s).",
                "tickets": [],
                "workOrders": docs,
                "requires_approval": False
            }

    # 3. Fast Status Updates
    if intent["action"] == "update":
        new_status = intent.get("new_status")
        if new_status:
            query = build_mongo_filter(intent)
            if query:
                collection = tickets_collection if intent["target"] == "tickets" else work_orders_collection
                id_field = "ticketId" if intent["target"] == "tickets" else "workOrderId"
                label = "ticket(s)" if intent["target"] == "tickets" else "work order(s)"
                
                matching = [serialize_doc(d) async for d in collection.find(query).limit(50)]
                if matching:
                    ids = [d[id_field] for d in matching if id_field in d]
                    await collection.update_many({id_field: {"$in": ids}}, {"$set": {"status": new_status}})
                    updated = [serialize_doc(d) async for d in collection.find({id_field: {"$in": ids}})]
                    return {
                        "reply": f"Successfully updated {len(updated)} {label} to {new_status}.",
                        "tickets": updated if intent["target"] == "tickets" else [],
                        "workOrders": updated if intent["target"] == "work_orders" else [],
                        "requires_approval": False
                    }
    return None

# --- LANGGRAPH FALLBACK SETUP ---
async def parse_intent_node(state: NLPGraphState) -> dict:
    return {"intent": extract_structured_intent_deterministic(state["command"])}

def supervisor_node(state: NLPGraphState) -> dict:
    return {"route": "search_agent" if state["intent"]["action"] == "query" else "mutation_agent"}

async def search_agent_node(state: NLPGraphState) -> dict:
    intent = state["intent"]
    query = build_mongo_filter(intent)
    if intent["target"] == "tickets":
        docs = [serialize_doc(d) async for d in tickets_collection.find(query).sort("createdAt", -1).limit(50)]
        return {"reply": f"Found {len(docs)} ticket(s).", "tickets": docs, "workOrders": []}
    else:
        docs = [serialize_doc(d) async for d in work_orders_collection.find(query).sort("createdAt", -1).limit(50)]
        return {"reply": f"Found {len(docs)} work order(s).", "tickets": [], "workOrders": docs}

async def mutation_agent_node(state: NLPGraphState) -> dict:
    intent = state["intent"]
    target, action = intent["target"], intent["action"]
    query = build_mongo_filter(intent)
    label = "ticket" if target == "tickets" else "work order"
    id_val = intent.get("ticket_id") if target == "tickets" else intent.get("work_order_id")

    if action == "delete":
        if not id_val:
            return {"reply": f"Please specify the exact {label} ID you want to delete."}
        return {
            "requires_approval": True, "pending_target": id_val,
            "target_type": "ticket" if target == "tickets" else "wo",
            "reply": f"SECURITY HOLD: Human authorization required to delete {label} {id_val}."
        }

    new_status = intent.get("new_status")
    if not new_status or not query:
        return {"reply": f"Insufficient data to update {label}. Please provide an ID and a new status."}

    collection = tickets_collection if target == "tickets" else work_orders_collection
    await collection.update_many(query, {"$set": {"status": new_status}})
    updated_docs = [serialize_doc(d) async for d in collection.find(query)]

    return {
        "reply": f"Successfully updated {len(updated_docs)} {label}(s) to {new_status}.",
        "tickets": updated_docs if target == "tickets" else [],
        "workOrders": updated_docs if target == "work_orders" else []
    }

workflow = StateGraph(NLPGraphState)
workflow.add_node("parse_intent", parse_intent_node)
workflow.add_node("supervisor", supervisor_node)
workflow.add_node("search_agent", search_agent_node)
workflow.add_node("mutation_agent", mutation_agent_node)

workflow.add_edge(START, "parse_intent")
workflow.add_edge("parse_intent", "supervisor")
workflow.add_conditional_edges("supervisor", lambda state: state["route"], {"search_agent": "search_agent", "mutation_agent": "mutation_agent"})
workflow.add_edge("search_agent", END)
workflow.add_edge("mutation_agent", END)

nlp_graph = workflow.compile()