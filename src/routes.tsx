import { generatePath, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
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
import { LedgerPage } from '@/features/admin/pages/LedgerPage';
import { SalariesAdvancesPage } from '@/features/admin/pages/SalariesAdvancesPage';
import { ExpensesPage } from '@/features/admin/pages/ExpensesPage';
import { PaymentsPage } from '@/features/admin/pages/PaymentsPage';
import { DocumentsPage } from '@/features/admin/pages/DocumentsPage';
import { ReportsPage } from '@/features/admin/pages/ReportsPage';
import { InboxPage } from '@/features/admin/pages/InboxPage';
import { CalculatorPage } from '@/features/admin/pages/CalculatorPage';
import { NotificationsPage } from '@/features/admin/pages/NotificationsPage';
import { SettingsPage } from '@/features/admin/pages/SettingsPage';
import { useApp } from '@/store';
import { isApiConfigured } from '@/features/api/mode';
import { navFor, useAdminRole, useCanOpen } from '@/features/admin/access';
import type { AdminNavKey } from '@/features/admin/nav';
import { NoAccessState } from '@/features/admin/components/states';
import { DriverAppNotice } from '@/features/driver/DriverAppNotice';

function RootRedirect() {
  const role = useApp((s) => s.role);
  const lastRoute = useApp((s) => s.lastRoute);
  // Real mode has one web experience: the office console. Drivers use the phone app.
  if (isApiConfigured()) return <Navigate to="/admin" replace />;
  return <Navigate to={lastRoute[role] || `/${role}`} replace />;
}

/** A screen the signed-in role may not open shows so; the API would refuse it anyway. */
function RequireModule({ module, children }: { module: AdminNavKey; children: React.ReactElement }) {
  return useCanOpen(module) ? children : <NoAccessState />;
}

/**
 * An older address for a screen that now lives elsewhere in the navigation. It lands on the one
 * canonical address — so the sidebar highlights the right section — and keeps the query string,
 * so saved links and notification links still open the same filtered view or record.
 */
function Moved({ to }: { to: string }) {
  const params = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`${generatePath(to, params)}${search}${hash}`} replace />;
}

/** Finance opens on the first of its screens this role may use (Expenses, for a manager). */
function FinanceIndex() {
  const role = useAdminRole();
  const finance = navFor(role).find((item) => item.key === 'finance');
  return <Navigate to={finance?.children?.[0]?.to ?? '/admin'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      {isApiConfigured() ? (
        <Route path="/driver/*" element={<DriverAppNotice />} />
      ) : (
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
      )}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="fleet" element={<Fleet />} />

        {/* People: Employees is the parent module. A driver is an employee with a driver profile;
            the Drivers view keeps its own address, which every driver link uses. */}
        <Route path="employees">
          <Route index element={<EmployeesPage />} />
          <Route path="staff" element={<EmployeesPage staffOnly />} />
          <Route path="drivers" element={<Moved to="/admin/drivers" />} />
          <Route path="drivers/:id" element={<Moved to="/admin/drivers/:id" />} />
        </Route>
        <Route path="drivers" element={<DriversPage />} />
        <Route path="drivers/:id" element={<DriverDetail />} />

        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="fuel" element={<FuelPage />} />

        {/* Consolidated Finance module */}
        <Route path="finance">
          <Route index element={<FinanceIndex />} />
          <Route path="ledger" element={<RequireModule module="ledger"><LedgerPage /></RequireModule>} />
          <Route path="salaries" element={<RequireModule module="salaries"><SalariesAdvancesPage /></RequireModule>} />
          <Route path="payments" element={<RequireModule module="payments"><PaymentsPage /></RequireModule>} />
          <Route path="expenses" element={<ExpensesPage />} />
        </Route>
        {/* Older direct finance addresses land inside Finance */}
        <Route path="expenses" element={<Moved to="/admin/finance/expenses" />} />
        <Route path="payments" element={<Moved to="/admin/finance/payments" />} />

        <Route path="documents" element={<DocumentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:report" element={<ReportsPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="settings" element={<RequireModule module="settings"><SettingsPage /></RequireModule>} />

        {/* Header utilities direct routes */}
        <Route path="calculator" element={<CalculatorPage />} />
        <Route path="notifications" element={<NotificationsPage />} />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
