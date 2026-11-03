import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Alerts from './pages/Alerts';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import { DriverDetail, VehicleDetail } from './pages/Details';
import { CheckinsPage, ContractsPage, DriversPage, ExpensesPage, FuelPage, MaintenancePage, PaymentsPage, TripsPage, VehiclesPage } from './pages/Simple';
import ManagerReport from './pages/ManagerReport';
import './styles.css';

function App() {
  const { user, ready } = useApp();
  if (!ready) return <div className="loading full">Loading…</div>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="drivers/:id" element={<DriverDetail />} />
        <Route path="trips" element={<TripsPage />} />
        <Route path="fuel" element={<FuelPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/manager" element={<ManagerReport />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route path="checkins" element={<CheckinsPage />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AppProvider><App /></AppProvider>
    </HashRouter>
  </StrictMode>,
);
