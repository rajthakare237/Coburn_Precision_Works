import os
from langchain_google_genai import ChatGoogleGenerativeAI

def get_routed_llm(query: str, context_length: int):
    """
    Dynamic Model Router: Analyzes query complexity and context size to route 
    requests dynamically, optimizing for Cost, Latency, or Reasoning capabilities.
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None

    # CRITICAL FIX: Ensure a valid Google model is used
    model_name = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
    word_count = len(query.split())
    
    is_complex = (
        word_count > 15 or 
        context_length > 2500 or 
        any(k in query.lower() for k in ["compare", "troubleshoot", "analyze", "why", "difference"])
    )
    
    if is_complex:
        print(f"🔀 [Model Router] Routing to HEAVY Reasoning Config ({model_name}, temp=0.3).")
        return ChatGoogleGenerativeAI(
            model=model_name, 
            google_api_key=api_key, 
            temperature=0.3,
            max_retries=1,
            timeout=25
        )
    else:
        print(f"⚡ [Model Router] Routing to FAST Lookup Config ({model_name}, temp=0.0).")
        return ChatGoogleGenerativeAI(
            model=model_name, 
            google_api_key=api_key, 
            temperature=0.0,
            max_retries=1,
            timeout=20
        )