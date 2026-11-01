import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Factory, Wrench, ClipboardList, Shield, LogOut, Bot, Menu, MessageSquareText, Sparkles, X, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { RAGPanel } from './RAGPanel';
import { ConfirmModal } from './ConfirmModal';
import api from '../services/api';
import './Layout.scss';
import '../pages/Tickets.scss';

export const Layout = () => {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ragOpen, setRagOpen] = useState(false);

  const [nlpQuery, setNlpQuery] = useState('');
  const [nlpResponse, setNlpResponse] = useState('');
  const [aiTickets, setAiTickets] = useState<any[]>([]);
  const [aiWorkOrders, setAiWorkOrders] = useState<any[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  // NEW: Collapse state for the AI Panel
  const [isAiPanelCollapsed, setIsAiPanelCollapsed] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<{ type: 'ticket' | 'wo'; id: string } | null>(null);

  const currentUser = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  })();

  const isAdmin = currentUser?.role === 'Admin';

  useEffect(() => {
    const closeAll = () => {
      setRagOpen(false);
      setNlpResponse('');
      setAiTickets([]);
      setAiWorkOrders([]);
    };
    window.addEventListener('close-all-popups', closeAll);
    return () => window.removeEventListener('close-all-popups', closeAll);
  }, []);

  const notifyPagesToRefresh = () => {
    window.dispatchEvent(new Event('ai-data-updated'));
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('user');
    navigate('/login');
  };

  const handleNlpSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlpQuery.trim()) return;

    setIsAiLoading(true);
    setNlpResponse('');
    setAiTickets([]);
    setAiWorkOrders([]);
    setIsAiPanelCollapsed(false); // Auto-expand when a new command is sent

    try {
      const res = await api.post('/ai/nlp-command', { command: nlpQuery });
      setNlpResponse(res.data.reply || 'Command completed.');
      setAiTickets(res.data.tickets || []);
      setAiWorkOrders(res.data.workOrders || []);
      
      if (res.data.requires_approval) {
        setConfirmDelete({
          type: res.data.target_type === 'wo' ? 'wo' : 'ticket',
          id: res.data.pending_target
        });
      }
      
      notifyPagesToRefresh();
    } catch {
      setNlpResponse('Error connecting to AI Agent. Please check your connection.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleTicketStatusChange = async (ticketId: string, newStatus: string) => {
    await api.patch(`/tickets/${ticketId}`, { status: newStatus });
    setAiTickets((prev) => prev.map((t) => (t.ticketId === ticketId ? { ...t, status: newStatus } : t)));
    notifyPagesToRefresh();
  };

  const handleWoStatusChange = async (workOrderId: string, newStatus: string) => {
    await api.patch(`/work-orders/${workOrderId}`, { status: newStatus });
    setAiWorkOrders((prev) => prev.map((w) => (w.workOrderId === workOrderId ? { ...w, status: newStatus } : w)));
    notifyPagesToRefresh();
  };

  const executeConfirmedDelete = async () => {
    if (!confirmDelete) return;
    setIsAiLoading(true);
    
    try {
      if (confirmDelete.type === 'ticket') {
        await api.delete(`/tickets/${confirmDelete.id}`);
        setAiTickets((prev) => prev.filter((t) => t.ticketId !== confirmDelete.id));
        setNlpResponse(`✅ Successfully authorized and deleted ticket ${confirmDelete.id}.`);
      } else {
        await api.delete(`/work-orders/${confirmDelete.id}`);
        setAiWorkOrders((prev) => prev.filter((w) => w.workOrderId !== confirmDelete.id));
        setNlpResponse(`✅ Successfully authorized and deleted work order ${confirmDelete.id}.`);
      }
    } catch (e) {
      setNlpResponse(`❌ Failed to delete ${confirmDelete.id}.`);
    }

    setConfirmDelete(null);
    notifyPagesToRefresh();
    setIsAiLoading(false);
  };

  const closeAiPanel = () => {
    setNlpResponse('');
    setAiTickets([]);
    setAiWorkOrders([]);
    setIsAiPanelCollapsed(false);
  };

  const navStyles = ({ isActive }: { isActive: boolean }) => ({
    padding: '0.75rem',
    textDecoration: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    borderRadius: '6px',
    color: isActive ? '#2563eb' : '#64748b',
    background: isActive ? '#eff6ff' : 'transparent',
    fontWeight: 500,
  });

  const totalAiItems = aiTickets.length + aiWorkOrders.length;

  return (
    <div className="app-container">
      {mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)}></div>}

      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>
          <Factory color="#2563eb" size={28} />
          <h2 style={{ fontSize: '1.2rem', color: '#1e293b' }}>
            Coburn Precision<br />Works
          </h2>
        </div>
        <nav style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <NavLink to="/work-orders" style={navStyles} onClick={() => setMobileMenuOpen(false)}>
            <ClipboardList size={20} /> Work Items
          </NavLink>
          <NavLink to="/tickets" style={navStyles} onClick={() => setMobileMenuOpen(false)}>
            <Wrench size={20} /> Machine Tickets
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" style={navStyles} onClick={() => setMobileMenuOpen(false)}>
              <Shield size={20} /> Admin Panel
            </NavLink>
          )}
        </nav>
      </aside>

      <div className="main-content">
        <header style={{ height: '70px', flexShrink: 0, background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexGrow: 1 }}>
            <button className="mobile-only" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setMobileMenuOpen(true)}>
              <Menu size={24} color="#64748b" />
            </button>
            <form onSubmit={handleNlpSearch} className="ai-search-container">
              <Sparkles size={18} color="#8b5cf6" style={{ marginRight: '0.5rem', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Ask AI (e.g., 'delete TKT-1001')..."
                value={nlpQuery}
                onChange={(e) => setNlpQuery(e.target.value)}
                disabled={isAiLoading}
                style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.9rem', color: '#1e293b' }}
              />
              {nlpQuery && !isAiLoading && (
                <button type="button" className="clear-query-btn" onClick={() => setNlpQuery('')} title="Clear input">
                  <X size={15} />
                </button>
              )}
            </form>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
                {currentUser?.name || 'User'}
              </p>
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                {currentUser?.role || 'Operator'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign Out"
              style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '0.45rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <LogOut size={18} color="#64748b" />
            </button>
          </div>
        </header>

        {(isAiLoading || nlpResponse || totalAiItems > 0) && (
          <div className={`ai-response-panel ${isAiPanelCollapsed ? 'collapsed' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isAiPanelCollapsed ? '0' : '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b5cf6', fontWeight: 600, fontSize: '0.9rem' }}>
                <Bot size={18} /> {isAiLoading ? 'Agent is analyzing command...' : 'Agent Response'}
                {!isAiLoading && totalAiItems > 0 && (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.25rem', fontWeight: 400 }}>
                    ({totalAiItems} items)
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {!isAiLoading && (
                  <button 
                    onClick={() => setIsAiPanelCollapsed(!isAiPanelCollapsed)} 
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title={isAiPanelCollapsed ? "Expand Panel" : "Collapse Panel"}
                  >
                    {isAiPanelCollapsed ? <ChevronDown size={20} color="#64748b" /> : <ChevronUp size={20} color="#64748b" />}
                  </button>
                )}
                {!isAiLoading && (
                  <button onClick={closeAiPanel} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Close">
                    <X size={20} color="#64748b" />
                  </button>
                )}
              </div>
            </div>

            {!isAiPanelCollapsed && (
              <div className="ai-response-body">
                {!isAiLoading && nlpResponse && (
                  <p style={{ fontSize: '0.92rem', color: '#1e293b', fontWeight: 500, margin: '0.25rem 0 0.5rem 0' }}>
                    {nlpResponse.replace(/\*\*/g, '').replace(/###/g, '')}
                  </p>
                )}

                {!isAiLoading && aiTickets.length > 0 && (
                  <div className="ai-cards-grid">
                    {aiTickets.map((t) => (
                      <div key={t._id || t.ticketId} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h4 style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                            <Wrench size={16} /> {t.ticketId}
                          </h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <select
                              className="form-input"
                              value={t.status}
                              onChange={(e) => handleTicketStatusChange(t.ticketId, e.target.value)}
                              style={{ fontSize: '0.75rem', padding: '0.2rem', width: 'auto' }}
                            >
                              <option value="OPEN">OPEN</option>
                              <option value="IN_PROGRESS">IN_PROGRESS</option>
                              <option value="RESOLVED">RESOLVED</option>
                            </select>
                            <Trash2
                              size={16}
                              color="#ef4444"
                              style={{ cursor: 'pointer' }}
                              onClick={() => setConfirmDelete({ type: 'ticket', id: t.ticketId })}
                            />
                          </div>
                        </div>
                        <p style={{ fontWeight: 600, marginTop: '0.75rem', fontSize: '0.9rem' }}>{t.title}</p>
                        {t.description && <p className="ticket-description-clamp">{t.description}</p>}
                        <div className="ticket-meta-footer">
                          <span>{t.machineModel}</span>
                          <span>Severity: {t.severity}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!isAiLoading && aiWorkOrders.length > 0 && (
                  <div className="ai-cards-grid">
                    {aiWorkOrders.map((item) => (
                      <div key={item._id || item.workOrderId} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold', color: '#2563eb' }}>{item.workOrderId}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <select
                              className="form-input"
                              value={item.status}
                              onChange={(e) => handleWoStatusChange(item.workOrderId, e.target.value)}
                              style={{ fontSize: '0.75rem', padding: '0.2rem', width: 'auto' }}
                            >
                              <option value="APPROVED">APPROVED</option>
                              <option value="IN_PROGRESS">IN_PROGRESS</option>
                              <option value="COMPLETED">COMPLETED</option>
                            </select>
                            <Trash2
                              size={16}
                              color="#ef4444"
                              style={{ cursor: 'pointer' }}
                              onClick={() => setConfirmDelete({ type: 'wo', id: item.workOrderId })}
                            />
                          </div>
                        </div>
                        <p style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0.75rem 0 0.5rem 0' }}>{item.title}</p>
                        <div className="ticket-meta-footer">
                          <span>Tech: {item.assignedTechnician}</span>
                          <span>Ticket: {item.sourceTicketId}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <main style={{ flexGrow: 1, overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>

      {!ragOpen && (
        <button className="floating-bot" onClick={() => setRagOpen(true)} title="Open Manuals AI Chat">
          <MessageSquareText size={28} />
        </button>
      )}

      <RAGPanel isOpen={ragOpen} onClose={() => setRagOpen(false)} />

      <ConfirmModal
        isOpen={Boolean(confirmDelete)}
        title={confirmDelete?.type === 'ticket' ? 'Delete Fault Ticket' : 'Delete Work Order'}
        message={`SECURITY HOLD: Are you sure you want to permanently delete ${confirmDelete?.id}?`}
        confirmLabel="Authorize Deletion"
        onConfirm={executeConfirmedDelete}
        onCancel={() => {
          setConfirmDelete(null);
          setNlpResponse(`❌ Deletion of ${confirmDelete?.id} canceled by user.`);
          setIsAiPanelCollapsed(false);
        }}
      />
    </div>
  );
};