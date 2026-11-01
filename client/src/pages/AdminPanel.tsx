import React, { useState, useEffect } from 'react';
import { Trash2, CheckCircle, Search, UserPlus } from 'lucide-react';
import api from '../services/api';
import { ConfirmModal } from '../components/ConfirmModal';
import './AdminPanel.scss';
import './Tickets.scss';

export const AdminPanel = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'pending' | 'create'>('active');
  const [searchEmail, setSearchEmail] = useState('');
  const [userToDelete, setUserToDelete] = useState<any | null>(null);

  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'Admin' });
  const [createMsg, setCreateMsg] = useState('');

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId: string, newRole: string) => {
    await api.patch(`/users/${userId}/role`, { role: newRole });
    fetchUsers();
  };

  const handleApprove = async (userId: string) => {
    await api.patch(`/users/${userId}/approve`);
    fetchUsers();
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await api.delete(`/users/${userToDelete._id}`);
      setUserToDelete(null);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Cannot delete user');
      setUserToDelete(null);
    }
  };

  const handleCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg('');
    try {
      await api.post('/users/admin', newUser);
      setCreateMsg('User created and activated successfully!');
      setNewUser({ name: '', email: '', password: '', role: 'Admin' });
      fetchUsers();
    } catch (err: any) {
      setCreateMsg(err.response?.data?.detail || 'Error creating user');
    }
  };

  const activeUsers = users.filter(
    (u) => u.status === 'ACTIVE' && u.email.toLowerCase().includes(searchEmail.toLowerCase())
  );
  const pendingUsers = users.filter((u) => u.status === 'PENDING');

  const formatDate = (iso: string) => {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  };

  return (
    <div className="page-wrapper">
      <h1 style={{ fontSize: '1.5rem', color: '#1e293b', marginBottom: '1rem' }}>System Administration</h1>

      <div className="admin-tabs">
        <button
          className={`admin-tab-btn ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          Active Users ({activeUsers.length})
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'pending' ? 'active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          Pending Approvals ({pendingUsers.length})
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'create' ? 'active' : ''}`}
          onClick={() => setActiveTab('create')}
        >
          Create Admin / User
        </button>
      </div>

      {activeTab === 'active' && (
        <>
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.5rem 0.75rem', width: '320px' }}>
            <Search size={16} color="#64748b" style={{ marginRight: '0.5rem' }} />
            <input
              type="text"
              placeholder="Search by email..."
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              style={{ border: 'none', outline: 'none', width: '100%', background: 'transparent' }}
            />
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((u) => (
                  <tr key={u._id}>
                    <td style={{ fontWeight: 500 }}>{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="form-input"
                        value={u.role}
                        onChange={(e) => handleRoleChange(u._id, e.target.value)}
                        style={{ width: 'auto', padding: '0.35rem 0.6rem' }}
                      >
                        <option value="Admin">Admin</option>
                        <option value="Floor Manager">Floor Manager</option>
                        <option value="Maintenance Tech">Maintenance Tech</option>
                        <option value="Operator">Operator</option>
                      </select>
                    </td>
                    <td>{formatDate(u.joined)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {u.email !== 'admin@gmail.com' && (
                        <Trash2
                          size={16}
                          color="#ef4444"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setUserToDelete(u)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'pending' && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          {pendingUsers.length === 0 ? (
            <p style={{ padding: '1.5rem', color: '#64748b' }}>No pending user requests.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Requested Role</th>
                  <th>Requested On</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingUsers.map((u) => (
                  <tr key={u._id}>
                    <td style={{ fontWeight: 500 }}>{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="form-input"
                        value={u.role}
                        onChange={(e) => handleRoleChange(u._id, e.target.value)}
                        style={{ width: 'auto', padding: '0.35rem 0.6rem' }}
                      >
                        <option value="Admin">Admin</option>
                        <option value="Floor Manager">Floor Manager</option>
                        <option value="Maintenance Tech">Maintenance Tech</option>
                        <option value="Operator">Operator</option>
                      </select>
                    </td>
                    <td>{formatDate(u.joined)}</td>
                    <td style={{ textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
                      <button
                        className="btn-primary"
                        onClick={() => handleApprove(u._id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button
                        onClick={() => setUserToDelete(u)}
                        style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem' }}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'create' && (
        <form className="card form-grid" style={{ maxWidth: '500px' }} onSubmit={handleCreateAdminUser}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserPlus size={20} color="#2563eb" /> Create New User / Admin
          </h3>
          {createMsg && (
            <div style={{ padding: '0.6rem', background: '#eff6ff', color: '#1e40af', borderRadius: '6px', fontSize: '0.85rem' }}>
              {createMsg}
            </div>
          )}
          <div>
            <label className="form-label">Full Name *</label>
            <input
              type="text"
              className="form-input"
              required
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Email *</label>
            <input
              type="email"
              className="form-input"
              required
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Temporary Password *</label>
            <input
              type="password"
              className="form-input"
              required
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Assign Role</label>
            <select
              className="form-input"
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
            >
              <option value="Admin">Admin</option>
              <option value="Floor Manager">Floor Manager</option>
              <option value="Maintenance Tech">Maintenance Tech</option>
              <option value="Operator">Operator</option>
            </select>
          </div>
          <button type="submit" className="btn-primary">
            Create Active User
          </button>
        </form>
      )}

      <ConfirmModal
        isOpen={Boolean(userToDelete)}
        title="Delete User Account"
        message={`Are you sure you want to remove ${userToDelete?.name} (${userToDelete?.email}) from the system?`}
        confirmLabel="Delete User"
        onConfirm={confirmDeleteUser}
        onCancel={() => setUserToDelete(null)}
      />
    </div>
  );
};