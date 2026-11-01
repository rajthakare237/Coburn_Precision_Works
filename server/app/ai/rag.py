import os
import json
import asyncio
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from app.db.database import pinecone_index
from app.ai.llm_router import get_routed_llm

try:
    from rank_bm25 import BM25Okapi
except ImportError:
    BM25Okapi = None

def _get_match_id(match, fallback_idx: int) -> str:
    if isinstance(match, dict):
        return str(match.get("id", fallback_idx))
    return str(getattr(match, "id", fallback_idx))

def _get_match_score(match) -> float:
    if isinstance(match, dict):
        return float(match.get("score", 0.0) or 0.0)
    return float(getattr(match, "score", 0.0) or 0.0)

def _get_match_meta(match) -> dict:
    if isinstance(match, dict):
        return match.get("metadata", {}) or {}
    return getattr(match, "metadata", {}) or {}

def extract_chunk_text(chunk) -> str:
    """Safely extracts string content from any LangChain AIMessageChunk format."""
    content = getattr(chunk, "content", "")
    if not content:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text", "") or item.get("content", "")))
            elif hasattr(item, "text"):
                parts.append(str( getattr(item, "text", "")))
        return "".join(parts)
    if isinstance(content, dict):
        return str(content.get("text", "") or content.get("content", ""))
    return str(content)

def reciprocal_rank_fusion(dense_matches: list, query: str, top_k: int = 4) -> list:
    """
    Implements Reciprocal Rank Fusion (RRF) to combine Dense Vector scores 
    with BM25 Sparse Keyword scores safely.
    """
    if not BM25Okapi or not dense_matches:
        return dense_matches[:top_k]

    try:
        tokenized_corpus = [
            _get_match_meta(match).get("text", "").lower().split() 
            for match in dense_matches
        ]
        # Avoid division-by-zero in BM25 if all chunks have empty text
        if not any(tokenized_corpus):
            return dense_matches[:top_k]

        bm25 = BM25Okapi(tokenized_corpus)
        tokenized_query = query.lower().split() or ["manual"]
        bm25_scores = bm25.get_scores(tokenized_query)

        dense_ranked = sorted(dense_matches, key=_get_match_score, reverse=True)
        dense_ranks = {_get_match_id(m, i): rank for rank, (i, m) in enumerate(enumerate(dense_ranked))}

        sparse_ranked_indices = sorted(range(len(bm25_scores)), key=lambda i: bm25_scores[i], reverse=True)
        sparse_ranks = {_get_match_id(dense_matches[i], i): rank for rank, i in enumerate(sparse_ranked_indices)}

        k = 60
        rrf_scores = {}
        for i, match in enumerate(dense_matches):
            doc_id = _get_match_id(match, i)
            d_rank = dense_ranks.get(doc_id, len(dense_matches))
            s_rank = sparse_ranks.get(doc_id, len(dense_matches))
            rrf_scores[doc_id] = (1.0 / (k + d_rank)) + (1.0 / (k + s_rank))

        rrf_ranked = sorted(
            dense_matches, 
            key=lambda m: rrf_scores.get(_get_match_id(m, 0), 0.0), 
            reverse=True
        )
        return rrf_ranked[:top_k]
    except Exception as e:
        print(f"⚠️ [BM25 Rerank Warning]: Falling back to dense matches: {e}")
        return dense_matches[:top_k]

async def ask_machine_manual(question: str, machine_model: str = None, history: list = None) -> dict:
    """Synchronous fallback execution for RAG."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return {"reply": "**Configuration Error:** `GOOGLE_API_KEY` is missing in `.env`.", "sources": []}
    if not pinecone_index:
        return {"reply": "**Configuration Error:** Pinecone index is not connected.", "sources": []}

    try:
        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001", 
            google_api_key=api_key
        )
        raw_vector = await asyncio.wait_for(
            asyncio.to_thread(embeddings.embed_query, question),
            timeout=15.0
        )
        query_vector = raw_vector[:768]
        filter_dict = {"machineModel": machine_model} if machine_model else None
        
        search_results = await asyncio.wait_for(
            asyncio.to_thread(
                pinecone_index.query, vector=query_vector, top_k=20, include_metadata=True, filter=filter_dict
            ),
            timeout=15.0
        )

        matches = search_results.get("matches", []) if isinstance(search_results, dict) else getattr(search_results, "matches", [])
        if not matches:
            return {
                "reply": "⚠️ **No Manual Data Found:** Your Pinecone vector index returned 0 matching chunks. Ensure `python scripts/ingest.py` has uploaded vectors.",
                "sources": []
            }

        best_matches = reciprocal_rank_fusion(matches, question, top_k=4)

        contexts, sources = [], []
        for match in best_matches:
            meta = _get_match_meta(match)
            text = meta.get("text", "")
            if text:
                contexts.append(text)
                sources.append({
                    "machineModel": meta.get("machineModel", "General"),
                    "pageNumber": meta.get("pageNumber", "N/A"),
                    "section": meta.get("section", "Manual")
                })

        context_string = "\n\n---\n\n".join(contexts)
        history_text = "\n".join([f"{msg.get('role', 'user').upper()}: {msg.get('content', '')}" for msg in (history or [])[-4:]])

        llm = get_routed_llm(question, len(context_string))
        prompt = f"""
        You are an expert industrial maintenance AI for Coburn Precision Works.
        Answer using ONLY the provided technical manual excerpts. Format cleanly with bullet points and bold text.
        History: {history_text}
        Context: {context_string}
        User Question: {question}
        """
        
        response = await asyncio.wait_for(llm.ainvoke(prompt), timeout=25.0)
        reply_text = extract_chunk_text(response)
        if not reply_text:
            reply_text = "⚠️ **Model Warning:** The AI returned an empty response."
        return {"reply": reply_text, "sources": sources[:3]}

    except asyncio.TimeoutError:
        return {"reply": "**Timeout Error:** Request timed out waiting for Google Gemini or Pinecone. Check your API quota or network connection.", "sources": []}
    except Exception as e:
        return {"reply": f"**RAG Error:** {str(e)}", "sources": []}


async def stream_machine_manual(question: str, machine_model: str = None, history: list = None):
    """Streaming SSE generator utilizing Hybrid RRF Search with explicit error reporting."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        yield f"data: {json.dumps({'error': 'GOOGLE_API_KEY is missing in your server .env file.'})}\n\n"
        yield "data: [DONE]\n\n"
        return
    if not pinecone_index:
        yield f"data: {json.dumps({'error': 'Pinecone index is not initialized. Check PINECONE_API_KEY and PINECONE_INDEX_NAME.'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    try:
        # 1. Generate Query Embedding (Non-blocking with 15s timeout)
        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001", 
            google_api_key=api_key
        )
        try:
            raw_vector = await asyncio.wait_for(
                asyncio.to_thread(embeddings.embed_query, question),
                timeout=15.0
            )
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'error': 'Embedding request timed out (15s). Your Google API key may be rate-limited (429 Quota Exceeded).'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        query_vector = raw_vector[:768]
        filter_dict = {"machineModel": machine_model} if machine_model else None
        
        # 2. Query Pinecone (Non-blocking with 15s timeout)
        try:
            search_results = await asyncio.wait_for(
                asyncio.to_thread(
                    pinecone_index.query, vector=query_vector, top_k=20, include_metadata=True, filter=filter_dict
                ),
                timeout=15.0
            )
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'error': 'Pinecone vector search timed out (15s). Check your internet/DNS connection.'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        matches = search_results.get("matches", []) if isinstance(search_results, dict) else getattr(search_results, "matches", [])
        if not matches:
            yield f"data: {json.dumps({'chunk': '⚠️ **No Manual Data Found:** Your Pinecone index returned 0 matching chunks. Please ensure `python scripts/ingest.py` has uploaded vectors to your index.'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # 3. Hybrid RRF Reranking
        best_matches = reciprocal_rank_fusion(matches, question, top_k=4)

        contexts, sources = [], []
        for match in best_matches:
            meta = _get_match_meta(match)
            text = meta.get("text", "")
            if text:
                contexts.append(text)
                sources.append({
                    "machineModel": meta.get("machineModel", "General"),
                    "pageNumber": meta.get("pageNumber", "N/A"),
                    "section": meta.get("section", "Manual")
                })

        if not contexts:
            yield f"data: {json.dumps({'chunk': '⚠️ **Metadata Error:** Vectors were found in Pinecone, but their `text` metadata field is empty.'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        context_string = "\n\n---\n\n".join(contexts)
        history_text = "\n".join([f"{msg.get('role', 'user').upper()}: {msg.get('content', '')}" for msg in (history or [])[-4:]])

        if sources:
            yield f"data: {json.dumps({'sources': sources[:3]})}\n\n"

        # 4. Route and Stream LLM Response
        llm = get_routed_llm(question, len(context_string))
        prompt = f"""
        You are an expert industrial maintenance AI for Coburn Precision Works.
        Answer the user's question using ONLY the provided technical manual excerpts.
        - Start with a direct, clear summary sentence.
        - Group technical values, specifications, or SOP steps using clean bullet points (- ).
        - Use bold text (**value**) for machine models, torque specs, fault codes, and part numbers.
        - If the answer is not in the context, state clearly that it is not found in the loaded manuals.

        History:
        {history_text}

        Context:
        {context_string}

        User Question: {question}
        """

        has_yielded_text = False
        async for chunk in llm.astream(prompt):
            chunk_text = extract_chunk_text(chunk)
            if chunk_text:
                has_yielded_text = True
                yield f"data: {json.dumps({'chunk': chunk_text})}\n\n"

        # Fallback if astream finished without yielding text
        if not has_yielded_text:
            fallback_res = await asyncio.wait_for(llm.ainvoke(prompt), timeout=20.0)
            fallback_text = extract_chunk_text(fallback_res)
            if fallback_text:
                yield f"data: {json.dumps({'chunk': fallback_text})}\n\n"
            else:
                yield f"data: {json.dumps({'error': 'The LLM completed the request but returned an empty response.'})}\n\n"

    except Exception as e:
        err_str = str(e) or repr(e)  # Forces the error to print even if the message is technically empty
        print(f"❌ [RAG Stream Exception]: {err_str}")
        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
            yield f"data: {json.dumps({'error': 'Google Gemini API Quota Exceeded (HTTP 429). Please update GOOGLE_API_KEY in your .env file and restart Uvicorn.'})}\n\n"
        elif "404" in err_str or "NOT_FOUND" in err_str:
            yield f"data: {json.dumps({'error': f'Invalid Gemini Model Name (HTTP 404). Check your .env file: {err_str}'})}\n\n"
        else:
            yield f"data: {json.dumps({'error': f'RAG Stream Error: {err_str}'})}\n\n"

    yield "data: [DONE]\n\n"