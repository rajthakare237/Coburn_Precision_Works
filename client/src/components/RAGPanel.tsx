import React, { useState, useRef, useEffect } from 'react';
import { X, Send, BookOpen, Bot, RotateCcw, ThumbsUp, ThumbsDown } from 'lucide-react';
import api from '../services/api';
import './RAGPanel.scss';

interface SourceMeta {
  machineModel: string;
  pageNumber: number | string;
  section: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceMeta[];
  rating?: number;
}

const INITIAL_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: 'Hello! I am your **Coburn Manuals AI**. Ask me about machine torque specs, PLC fault codes, or maintenance SOPs.'
};

const SUGGESTIONS = [
  'What is the torque for Siemens machines?',
  'How to resolve fault ERR-SIE150-SPN-1?',
  'What are the features of Prismo Z300?'
];

export const RAGPanel = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || loading) return;

    const historyPayload = messages.map(m => ({ role: m.role, content: m.content }));
    const newMessages: ChatMessage[] = [
      ...messages, 
      { role: 'user', content: trimmed },
      { role: 'assistant', content: '', sources: [] }
    ];
    setMessages(newMessages);
    setQuery('');
    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40000); // 40s hard safety timeout

    try {
      const token = sessionStorage.getItem('accessToken');
      const res = await fetch('https://djo6mvw7bibpd.cloudfront.net/api/ai/rag-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ question: trimmed, history: historyPayload }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server returned HTTP ${res.status}: ${errText || res.statusText}`);
      }

      if (!res.body) {
        throw new Error('No readable stream available from server.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let streamedContent = '';
      let streamedSources: SourceMeta[] = [];
      let buffer = '';

      const processLine = (part: string) => {
        const trimmedPart = part.trim();
        if (!trimmedPart.startsWith('data: ')) return;
        const dataStr = trimmedPart.slice(6).trim();
        if (dataStr === '[DONE]') return;

        try {
          const data = JSON.parse(dataStr);
          if (data.chunk) streamedContent += data.chunk;
          if (data.sources) streamedSources = data.sources;
          if (data.error) {
            streamedContent += (streamedContent ? '\n\n' : '') + `❌ **Error:** ${data.error}`;
          }

          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: 'assistant',
              content: streamedContent,
              sources: streamedSources
            };
            return updated;
          });
        } catch (parseErr) {
          console.error('SSE JSON parse error:', parseErr);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          processLine(part);
        }
      }

      if (buffer.trim()) {
        processLine(buffer);
      }

      // Guarantee the chat bubble is never left blank after the stream closes
      if (!streamedContent.trim()) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: '⚠️ **No Answer Generated:** The stream closed without returning text. Please check your Uvicorn terminal for API quota or model errors.',
            sources: streamedSources
          };
          return updated;
        });
      }
    } catch (err: any) {
      const errorMsg = err?.name === 'AbortError'
        ? '❌ **Timeout Error:** The server took longer than 40 seconds to respond. Check if your Google API key has exceeded its quota.'
        : `❌ **Connection Error:** ${err?.message || 'Failed to connect to the RAG server.'}`;

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: errorMsg
        };
        return updated;
      });
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const handleFeedback = async (index: number, rating: number) => {
    setMessages(prev => {
      const updated = [...prev];
      updated[index].rating = rating;
      return updated;
    });

    try {
      await api.post('/ai/feedback', { message_idx: index, rating });
    } catch (err) {
      console.error("Telemetry error:", err);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendQuestion(query);
  };

  const handleClearChat = () => {
    setMessages([INITIAL_MESSAGE]);
  };

  const parseInlineFormatting = (line: string) => {
    const tokens = line.split(/(\*\*.*?\*\*|`.*?`)/g);
    return tokens.map((token, idx) => {
      if (token.startsWith('**') && token.endsWith('**')) return <strong key={idx}>{token.slice(2, -2)}</strong>;
      if (token.startsWith('`') && token.endsWith('`')) return <code key={idx} className="inline-code">{token.slice(1, -1)}</code>;
      return token;
    });
  };

  const renderFormattedMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let currentList: React.ReactNode[] = [];

    const flushList = (keyPrefix: string) => {
      if (currentList.length > 0) {
        elements.push(<ul key={`list-${keyPrefix}`} className="rag-list">{currentList}</ul>);
        currentList = [];
      }
    };

    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!line) { flushList(String(idx)); return; }

      if (line.startsWith('### ') || line.startsWith('## ') || line.startsWith('# ')) {
        flushList(String(idx));
        const cleanHeading = line.replace(/^#+\s*/, '');
        elements.push(<h4 key={idx} className="rag-heading">{parseInlineFormatting(cleanHeading)}</h4>);
      } else if (line.startsWith('* ') || line.startsWith('- ') || /^\d+\.\s/.test(line)) {
        const cleanItem = line.replace(/^(\*|-|\d+\.)\s*/, '');
        currentList.push(<li key={`item-${idx}`}>{parseInlineFormatting(cleanItem)}</li>);
      } else {
        flushList(String(idx));
        elements.push(<p key={idx} className="rag-paragraph">{parseInlineFormatting(line)}</p>);
      }
    });

    flushList('end');
    return <div className="formatted-rag-content">{elements}</div>;
  };

  return (
    <div className={`rag-panel ${isOpen ? 'open' : ''}`}>
      <div className="rag-header">
        <div className="rag-header-title">
          <BookOpen size={20} color="#2563eb" />
          <h3>Manuals AI</h3>
          <span className="status-dot" title="Connected to Vector Index" />
        </div>
        <div className="rag-header-actions">
          <button className="icon-btn" onClick={handleClearChat} title="Clear Chat"><RotateCcw size={15} color="#475569" /></button>
          <button className="icon-btn" onClick={onClose} title="Close Panel"><X size={18} color="#1e293b" /></button>
        </div>
      </div>

      <div className="rag-chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message-row ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="bot-avatar"><Bot size={16} /></div>
            )}
            <div className={`chat-bubble ${msg.role}`}>
              {msg.role === 'assistant' ? (
                <>
                  {msg.content === '' && loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.85rem' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '14px', background: '#3b82f6', animation: 'blink 1s step-end infinite' }}></span>
                      Searching manuals & generating response...
                    </div>
                  ) : (
                    renderFormattedMarkdown(msg.content)
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="rag-sources">
                      {msg.sources.map((s, idx) => (
                        <span key={idx} className="source-tag">📄 {s.machineModel} (p.{s.pageNumber})</span>
                      ))}
                    </div>
                  )}
                  
                  {msg.content !== '' && i !== 0 && (
                    <div className="message-feedback">
                      <button className={`feedback-btn ${msg.rating === 1 ? 'active-up' : ''}`} onClick={() => handleFeedback(i, 1)} title="Accurate Response">
                        <ThumbsUp size={14} />
                      </button>
                      <button className={`feedback-btn ${msg.rating === -1 ? 'active-down' : ''}`} onClick={() => handleFeedback(i, -1)} title="Inaccurate or Hallucinated">
                        <ThumbsDown size={14} />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}

        {messages.length === 1 && !loading && (
          <div className="rag-suggestions">
            <span className="suggestion-label">Suggested Questions</span>
            {SUGGESTIONS.map((item, idx) => (
              <button key={idx} className="suggestion-chip" onClick={() => sendQuestion(item)}>{item}</button>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="rag-input-bar" onSubmit={handleFormSubmit}>
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask a question about machines..." disabled={loading} />
        <button type="submit" className="send-btn" disabled={loading || !query.trim()}><Send size={16} /></button>
      </form>
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
};