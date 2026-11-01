import re

class SecurityGuardrailException(Exception):
    pass

def apply_input_guardrails(prompt: str) -> str:
    """
    Validates user input against prompt injection techniques and payload limits.
    """
    if not prompt or not prompt.strip():
        raise SecurityGuardrailException("Input cannot be empty.")

    sanitized = prompt.strip()

    # 1. Token/Length Constraint (Prevent 'Denial of Wallet')
    if len(sanitized) > 1500:
        raise SecurityGuardrailException("Input exceeds maximum allowed character length (1500).")

    # 2. Prompt Injection & Jailbreak Heuristics
    injection_patterns = [
        r"(?i)\b(ignore|disregard|forget)\b.*\b(instructions|prompt|rules)\b",
        r"(?i)\b(system\s+prompt|new\s+instructions)\b",
        r"(?i)\b(you\s+are\s+now|act\s+as\s+an\s+uncensored)\b",
        r"(?i)\[\s*system\s*\]",
        r"(?i)\b(bypass|jailbreak|exploit|DAN\b)"
    ]

    for pattern in injection_patterns:
        if re.search(pattern, sanitized):
            raise SecurityGuardrailException("Unauthorized instruction override or system prompt exposure detected.")

    # 3. Hardcoded Database Abuse Stop-words
    abuse_patterns = [
        r"(?i)\b(drop\s+table|delete\s+from)\b" 
    ]
    for pattern in abuse_patterns:
        if re.search(pattern, sanitized):
            raise SecurityGuardrailException("Restricted database operation keyword detected.")

    return sanitized