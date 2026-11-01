import React, { useState, useEffect } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { Trash2, Search, X } from 'lucide-react';
import api from '../services/api';
import { ConfirmModal } from '../components/ConfirmModal';
import './Tickets.scss';
import '../components/ConfirmModal.scss';

export const WorkOrders = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [woToDelete, setWoToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    sourceTicketId: '',
    machineId: '',
    machineModel: '',
    title: '',
    priority: 'P2_NORMAL',
    assignedTechnician: '',
    estimatedHours: 4,
    resolutionNotes: '',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/work-orders');
      setOrders(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    window.addEventListener('ai-data-updated', fetchOrders);
    return () => window.removeEventListener('ai-data-updated', fetchOrders);
  }, []);

  const openCreateModalExclusively = () => {
    // Close any open AI/RAG popups or delete modals so ONLY the New Work Order popup is shown
    window.dispatchEvent(new Event('close-all-popups'));
    setWoToDelete(null);
    setShowCreateModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;
    await api.post('/work-orders', formData);
    setShowCreateModal(false);
    setFormData({
      sourceTicketId: '',
      machineId: '',
      machineModel: '',
      title: '',
      priority: 'P2_NORMAL',
      assignedTechnician: '',
      estimatedHours: 4,
      resolutionNotes: '',
    });
    fetchOrders();
  };

  const confirmDeleteWorkOrder = async () => {
    if (!woToDelete) return;
    await api.delete(`/work-orders/${woToDelete}`);
    setWoToDelete(null);
    fetchOrders();
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    await api.patch(`/work-orders/${id}`, { status: newStatus });
    fetchOrders();
  };

  const filteredOrders = orders.filter((o) => {
    const safeId = (o.workOrderId || '').toLowerCase();
    const safeTitle = (o.title || '').toLowerCase();
    const safeTech = (o.assignedTechnician || '').toLowerCase();
    const search = searchQuery.toLowerCase();

    const matchesSearch = safeId.includes(search) || safeTitle.includes(search) || safeTech.includes(search);
    const matchesStatus = statusFilter === 'ALL' || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="page-wrapper">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2>Work Orders</h2>
        <button className="btn-primary" onClick={openCreateModalExclusively}>
          + New Work Order
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.5rem 0.75rem', width: '320px' }}>
          <Search size={16} color="#64748b" style={{ marginRight: '0.5rem' }} />
          <input
            type="text"
            placeholder="Search work orders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: 'none', outline: 'none', width: '100%', background: 'transparent' }}
          />
        </div>
        <select
          className="form-input"
          style={{ width: 'auto' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">All Statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </div>

      <div style={{ flexGrow: 1, background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '1rem' }}>
        {isLoading ? (
          <div className="loader-container">
            <div className="spinner"></div>
            <p>Loading work orders from database...</p>
          </div>
        ) : filteredOrders.length > 0 ? (
          <VirtuosoGrid
            style={{ height: '100%' }}
            totalCount={filteredOrders.length}
            listClassName="responsive-grid"
            itemContent={(index) => {
              const item = filteredOrders[index];
              return (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold', color: '#2563eb' }}>{item.workOrderId}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <select
                        className="form-input"
                        value={item.status}
                        onChange={(e) => handleStatusChange(item.workOrderId, e.target.value)}
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', width: 'auto' }}
                      >
                        <option value="APPROVED">APPROVED</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="COMPLETED">COMPLETED</option>
                      </select>
                      <Trash2
                        size={16}
                        color="#ef4444"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setShowCreateModal(false);
                          setWoToDelete(item.workOrderId);
                        }}
                      />
                    </div>
                  </div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0.75rem 0 0.5rem 0', color: '#0f172a' }}>
                    {item.title}
                  </p>
                  {item.resolutionNotes && (
                    <p className="ticket-description-clamp" title={item.resolutionNotes}>
                      {item.resolutionNotes}
                    </p>
                  )}
                  <div className="ticket-meta-footer">
                    <span>👤 {item.assignedTechnician || 'Unassigned'}</span>
                    <span>Ticket: {item.sourceTicketId || 'N/A'}</span>
                  </div>
                </div>
              );
            }}
          />
        ) : (
          <p style={{ color: '#64748b' }}>No Work Orders found.</p>
        )}
      </div>

      {/* Exclusive Create Work Order Popup Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Work Order</h3>
              <button className="modal-close-btn" onClick={() => setShowCreateModal(false)} title="Close popup">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Work Order Title *</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g., [Siemens-DMG-X150] Electro-Spindle Assembly"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">Source Ticket ID *</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g., TKT-2026-1001"
                  value={formData.sourceTicketId}
                  onChange={(e) => setFormData({ ...formData, sourceTicketId: e.target.value })}
                />
              </div>
              <div>
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
              <div>
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
              <div>
                <label className="form-label">Priority</label>
                <select
                  className="form-input"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                >
                  <option value="P1_URGENT">P1_URGENT</option>
                  <option value="P2_NORMAL">P2_NORMAL</option>
                  <option value="P3_LOW">P3_LOW</option>
                </select>
              </div>
              <div>
                <label className="form-label">Assigned Technician *</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g., Siddharth Verma"
                  value={formData.assignedTechnician}
                  onChange={(e) => setFormData({ ...formData, assignedTechnician: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">Estimated Hours</label>
                <input
                  type="number"
                  step="0.5"
                  className="form-input"
                  value={formData.estimatedHours}
                  onChange={(e) => setFormData({ ...formData, estimatedHours: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Resolution / SOP Notes</label>
                <textarea
                  className="form-input"
                  placeholder="Specify required replacement kits and torque SOP notes..."
                  value={formData.resolutionNotes}
                  onChange={(e) => setFormData({ ...formData, resolutionNotes: e.target.value })}
                  style={{ height: '80px', resize: 'none' }}
                />
              </div>
              <div className="modal-actions" style={{ gridColumn: 'span 2', marginTop: '0.5rem' }}>
                <button type="button" className="btn-cancel" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Work Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Popup */}
      <ConfirmModal
        isOpen={!showCreateModal && Boolean(woToDelete)}
        title="Delete Work Order"
        message={`Are you sure you want to permanently delete work order ${woToDelete}? This action cannot be undone.`}
        confirmLabel="Delete Work Order"
        onConfirm={confirmDeleteWorkOrder}
        onCancel={() => setWoToDelete(null)}
      />
    </div>
  );
};