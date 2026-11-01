import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SignIn, SignUp } from './pages/Auth';
import { Tickets } from './pages/Tickets';
import { WorkOrders } from './pages/WorkOrders';
import { AdminPanel } from './pages/AdminPanel';
import api from './services/api';
import './styles/global.scss';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(() => {
    return sessionStorage.getItem('accessToken') ? 'authenticated' : 'checking';
  });

  useEffect(() => {
    if (authStatus === 'checking') {
      api
        .post('/auth/refresh')
        .then((res) => {
          sessionStorage.setItem('accessToken', res.data.accessToken);
          sessionStorage.setItem('user', JSON.stringify(res.data.user));
          setAuthStatus('authenticated');
        })
        .catch(() => {
          setAuthStatus('unauthenticated');
        });
    }
  }, [authStatus]);

  if (authStatus === 'checking') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Verifying session...
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const user = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  })();

  if (user?.role !== 'Admin') {
    return <Navigate to="/tickets" replace />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/tickets" replace />} />
          <Route path="work-orders" element={<WorkOrders />} />
          <Route path="tickets" element={<Tickets />} />
          <Route
            path="admin"
            element={
              <AdminRoute>
                <AdminPanel />
              </AdminRoute>
            }
          />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;