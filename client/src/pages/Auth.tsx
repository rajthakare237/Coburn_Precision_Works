import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import './Auth.scss';
import './Tickets.scss';

export const SignIn = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      sessionStorage.setItem('accessToken', res.data.accessToken);
      sessionStorage.setItem('user', JSON.stringify(res.data.user));
      navigate('/tickets');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid login credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-card">
        <h2>Coburn Precision Works</h2>
        <p className="auth-subtitle">Sign in to your enterprise portal</p>

        {error && <div className="auth-alert error">{error}</div>}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
          <div>
            <label className="form-label">Work Email</label>
            <input
              type="email"
              className="form-input"
              required
              placeholder="admin@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '0.5rem', padding: '0.65rem' }}>
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: '#64748b' }}>
          Need an account?{' '}
          <Link to="/signup" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>
            Request Access
          </Link>
        </p>
      </div>
    </div>
  );
};

export const SignUp = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Operator');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await api.post('/auth/signup', { name, email, password, role });
      setSuccessMsg(res.data.message);
      setName('');
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-card">
        <h2>Coburn Precision Works</h2>
        <p className="auth-subtitle">Request account access</p>

        {error && <div className="auth-alert error">{error}</div>}
        {successMsg && <div className="auth-alert success">{successMsg}</div>}

        <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
          <div>
            <label className="form-label">Full Name</label>
            <input
              type="text"
              className="form-input"
              required
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Work Email</label>
            <input
              type="email"
              className="form-input"
              required
              placeholder="john@factory.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Requested Role</label>
            <select className="form-input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="Operator">Operator</option>
              <option value="Maintenance Tech">Maintenance Tech</option>
              <option value="Floor Manager">Floor Manager</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '0.5rem', padding: '0.65rem' }}>
            {loading ? 'Submitting...' : 'Request Access'}
          </button>
        </form>

        <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: '#64748b' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
};