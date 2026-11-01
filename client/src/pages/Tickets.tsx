import React, { useState, useEffect } from 'react';
import { Wrench, Trash2, Search } from 'lucide-react';
import api from '../services/api';
import { ConfirmModal } from '../components/ConfirmModal';
import './Tickets.scss';

export const Tickets = () => {
  const [view, setView] = useState<'list' | 'raise'>('list');
  const [tickets, setTickets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    machineId: '',
    machineModel: '',
    severity: 'MEDIUM',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const fetchTickets = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/tickets');
      setTickets(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
    window.addEventListener('ai-data-updated', fetchTickets);
    return () => window.removeEventListener('ai-data-updated', fetchTickets);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.machineId.trim()) return;
    await api.post('/tickets', formData);
    setFormData({ title: '', description: '', machineId: '', machineModel: '', severity: 'MEDIUM' });
    setView('list');
    fetchTickets();
  };

  const confirmDeleteTicket = async () => {
    if (!ticketToDelete) return;
    await api.delete(`/tickets/${ticketToDelete}`);
    setTicketToDelete(null);
    fetchTickets();
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    await api.patch(`/tickets/${id}`, { status: newStatus });
    fetchTickets();
  };

  const filteredTickets = tickets.filter((t) => {
    const safeId = (t.ticketId || '').toLowerCase();
    const safeTitle = (t.title || '').toLowerCase();
    const safeDesc = (t.description || '').toLowerCase();
    const search = searchQuery.toLowerCase();

    const matchesSearch = safeId.includes(search) || safeTitle.includes(search) || safeDesc.includes(search);
    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="page-wrapper">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Machine Fault Tickets</h2>
        <button className="btn-primary" onClick={() => setView(view === 'list' ? 'raise' : 'list')}>
          {view === 'list' ? '+ Raise Ticket' : 'Back to Tickets'}
        </button>
      </div>

      {view === 'raise' ? (
        <form className="card form-grid" style={{ maxWidth: '620px' }} onSubmit={handleSubmit}>
          <h3>Report New Machine Fault</h3>
          <div>
            <label className="form-label">Ticket Title *</label>
            <input
              type="text"
              className="form-input"
              required
              placeholder="e.g., 120-Bar Cryo Coolant Loop Deviation"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label className="form-label">Machine ID *</label>
              <input
                type="text"
                className="form-input"
                required
                placeholder="e.g., CNC-MILL-0001"
                value={formData.machineId}
                onChange={(e) => setFormData({ ...formData, machineId: e.target.value })}
              />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label className="form-label">Machine Model *</label>
              <input
                type="text"
                className="form-input"
                required
                placeholder="e.g., Siemens-DMG-X150"
                value={formData.machineModel}
                onChange={(e) => setFormData({ ...formData, machineModel: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="form-label">Severity Level</label>
            <select
              className="form-input"
              value={formData.severity}
              onChange={(e) => setFormData({ ...formData, severity: e.target.value })}
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>
          <div>
            <label className="form-label">Fault Description *</label>
            <textarea
              className="form-input"
              required
              placeholder="Describe telemetry sensor readings, PLC registers, and symptoms..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              style={{ height: '110px', resize: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setView('list')}
              style={{ padding: '0.55rem 1rem', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Submit Ticket
            </button>
          </div>
        </form>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.5rem 0.75rem', width: '320px' }}>
              <Search size={16} color="#64748b" style={{ marginRight: '0.5rem' }} />
              <input
                type="text"
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ border: 'none', outline: 'none', width: '100%', background: 'transparent' }}
              />
            </div>
            <select
              className="form-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          {isLoading ? (
            <div className="loader-container">
              <div className="spinner"></div>
              <p>Loading tickets from database...</p>
            </div>
          ) : (
            <div className="responsive-grid" style={{ padding: 0 }}>
              {filteredTickets.map((t) => (
                <div key={t._id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                        <Wrench size={16} /> {t.ticketId}
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <select
                          className="form-input"
                          value={t.status}
                          onChange={(e) => handleStatusChange(t.ticketId, e.target.value)}
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', width: 'auto' }}
                        >
                          <option value="OPEN">OPEN</option>
                          <option value="IN_PROGRESS">IN_PROGRESS</option>
                          <option value="RESOLVED">RESOLVED</option>
                        </select>
                        <Trash2
                          size={16}
                          color="#ef4444"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setTicketToDelete(t.ticketId)}
                        />
                      </div>
                    </div>

                    <p style={{ fontWeight: 600, marginTop: '0.75rem', fontSize: '0.92rem', color: '#0f172a' }}>
                      {t.title}
                    </p>

                    {/* Up to 3 lines of description */}
                    {t.description && (
                      <p className="ticket-description-clamp" title={t.description}>
                        {t.description}
                      </p>
                    )}
                  </div>

                  <div className="ticket-meta-footer">
                    <span>{t.machineModel || t.machineId}</span>
                    <span style={{ fontWeight: 600 }}>Severity: {t.severity}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={Boolean(ticketToDelete)}
        title="Delete Fault Ticket"
        message={`Are you sure you want to permanently delete ticket ${ticketToDelete}? This action cannot be undone.`}
        confirmLabel="Delete Ticket"
        onConfirm={confirmDeleteTicket}
        onCancel={() => setTicketToDelete(null)}
      />
    </div>
  );
};