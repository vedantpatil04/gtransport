import { Navigate, Route, Routes } from 'react-router-dom';
import { DriverLayout } from '@/layouts/DriverLayout';
import { DriverHome } from '@/features/driver/pages/DriverHome';
import { AddFuel } from '@/features/driver/pages/AddFuel';
import { Updates } from '@/features/driver/pages/Updates';
import { DriverPayments, DriverPaymentDetail } from '@/features/driver/pages/Payments';
import { DriverDocuments, DriverDocumentDetail } from '@/features/driver/pages/Documents';
import { DriverProfile } from '@/features/driver/pages/Profile';
import { DriverNotifications } from '@/features/driver/pages/DriverNotifications';
import { AdminLayout } from '@/layouts/AdminLayout';
import { Dashboard } from '@/features/admin/pages/Dashboard';
import { Fleet } from '@/features/admin/pages/Fleet';
import { EmployeesPage } from '@/features/admin/pages/EmployeesPage';
import { DriversPage } from '@/features/admin/pages/DriversPage';
import { DriverDetail } from '@/features/admin/pages/DriverDetail';
import { VehiclesPage, VehicleDetail } from '@/features/admin/pages/VehiclesPage';
import { FuelPage } from '@/features/admin/pages/FuelPage';
import { ExpensesPage } from '@/features/admin/pages/ExpensesPage';
import { PaymentsPage } from '@/features/admin/pages/PaymentsPage';
import { DocumentsPage } from '@/features/admin/pages/DocumentsPage';
import { ReportsPage } from '@/features/admin/pages/ReportsPage';
import { CalculatorPage } from '@/features/admin/pages/CalculatorPage';
import { NotificationsPage } from '@/features/admin/pages/NotificationsPage';
import { SettingsPage } from '@/features/admin/pages/SettingsPage';
import { useApp } from '@/store';

function RootRedirect() {
  const role = useApp((s) => s.role);
  const lastRoute = useApp((s) => s.lastRoute);
  return <Navigate to={lastRoute[role] || `/${role}`} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/driver" element={<DriverLayout />}>
        <Route index element={<DriverHome />} />
        <Route path="fuel/new" element={<AddFuel />} />
        <Route path="updates" element={<Updates />} />
        <Route path="payments" element={<DriverPayments />} />
        <Route path="payments/:id" element={<DriverPaymentDetail />} />
        <Route path="documents" element={<DriverDocuments />} />
        <Route path="documents/:id" element={<DriverDocumentDetail />} />
        <Route path="profile" element={<DriverProfile />} />
        <Route path="notifications" element={<DriverNotifications />} />
        <Route path="*" element={<Navigate to="/driver" replace />} />
      </Route>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="fleet" element={<Fleet />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="drivers/:id" element={<DriverDetail />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="fuel" element={<FuelPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="calculator" element={<CalculatorPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
