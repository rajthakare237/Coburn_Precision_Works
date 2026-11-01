import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.ai.agent import nlp_graph, try_fast_nlp_execution
from app.ai.rag import ask_machine_manual, stream_machine_manual
from app.core.guardrails import apply_input_guardrails, SecurityGuardrailException

router = APIRouter(prefix="/api/ai", tags=["AI Operations"])

class NLPCommand(BaseModel):
    command: str

class RAGQuery(BaseModel):
    question: str
    machineModel: str | None = None
    history: list | None = None

class AIFeedback(BaseModel):
    message_idx: int
    rating: int # 1 for positive, -1 for negative
    comment: str | None = None

@router.post("/feedback")
async def submit_telemetry_feedback(req: AIFeedback):
    """
    MLOps Telemetry Endpoint: Captures user evaluation of AI responses.
    In production, this feeds into DeepEval or LangSmith datasets to measure model drift and RAG accuracy.
    """
    sentiment = "👍 POSITIVE" if req.rating == 1 else "👎 NEGATIVE"
    print(f"📊 [MLOps Telemetry] User submitted {sentiment} feedback for interaction index {req.message_idx}.")
    return {"status": "success", "message": "Feedback captured for evaluation pipelines."}

@router.post("/nlp-command")
async def execute_nlp_command(req: NLPCommand):
    try:
        safe_command = apply_input_guardrails(req.command)
    except SecurityGuardrailException as e:
        return {"reply": f"Security Alert###{str(e)}", "tickets": [], "workOrders": [], "requires_approval": False}

    fast_result = await try_fast_nlp_execution(safe_command)
    if fast_result is not None:
        return fast_result

    try:
        result = await nlp_graph.ainvoke({
            "command": safe_command, "intent": {}, "route": "", "requires_approval": False,
            "pending_target": "", "target_type": "", "reply": "", "tickets": [], "workOrders": []
        })
        return {
            "reply": result.get("reply", "Command executed."),
            "tickets": result.get("tickets", []),
            "workOrders": result.get("workOrders", []),
            "requires_approval": result.get("requires_approval", False),
            "pending_target": result.get("pending_target", ""),
            "target_type": result.get("target_type", "")
        }
    except Exception as e:
        return {"reply": f"Unable to process command: {str(e)}", "tickets": [], "workOrders": [], "requires_approval": False}

@router.post("/rag")
async def execute_rag_query(req: RAGQuery):
    try:
        safe_question = apply_input_guardrails(req.question)
        return await ask_machine_manual(safe_question, req.machineModel, req.history)
    except Exception as e:
        return {"reply": f"System Error###{str(e)}", "sources": []}

@router.post("/rag-stream")
async def execute_rag_stream(req: RAGQuery):
    try:
        safe_question = apply_input_guardrails(req.question)
        return StreamingResponse(
            stream_machine_manual(safe_question, req.machineModel, req.history), 
            media_type="text/event-stream"
        )
    except SecurityGuardrailException as e:
        async def error_stream():
            yield f"data: {json.dumps({'error': f'Security Alert: {str(e)}'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")