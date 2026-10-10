import { lazy, Suspense } from 'react';
import { PageLoading } from '@/components/PageLoading';
import { generatePath, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { DriverLayout } from '@/layouts/DriverLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { useApp } from '@/store';
import { isApiConfigured } from '@/features/api/mode';
import { navFor, useAdminRole, useCanOpen } from '@/features/admin/access';
import type { AdminNavKey } from '@/features/admin/nav';
import { NoAccessState } from '@/features/admin/components/states';
import { DriverAppNotice } from '@/features/driver/DriverAppNotice';
import { inNativeApp } from '@/features/api/handoff';
import { LandingPage } from '@/features/landing/LandingPage';

/**
 * Pages load when first opened, not with the app: the console's first paint (and the phone app's
 * WebView) only pays for the screen being shown. Layouts stay eager — they are the shell.
 */
const DriverHome = lazy(() => import('@/features/driver/pages/DriverHome').then((m) => ({ default: m.DriverHome })));
const AddFuel = lazy(() => import('@/features/driver/pages/AddFuel').then((m) => ({ default: m.AddFuel })));
const Updates = lazy(() => import('@/features/driver/pages/Updates').then((m) => ({ default: m.Updates })));
const DriverPayments = lazy(() => import('@/features/driver/pages/Payments').then((m) => ({ default: m.DriverPayments })));
const DriverPaymentDetail = lazy(() => import('@/features/driver/pages/Payments').then((m) => ({ default: m.DriverPaymentDetail })));
const DriverDocuments = lazy(() => import('@/features/driver/pages/Documents').then((m) => ({ default: m.DriverDocuments })));
const DriverDocumentDetail = lazy(() => import('@/features/driver/pages/Documents').then((m) => ({ default: m.DriverDocumentDetail })));
const DriverProfile = lazy(() => import('@/features/driver/pages/Profile').then((m) => ({ default: m.DriverProfile })));
const DriverNotifications = lazy(() => import('@/features/driver/pages/DriverNotifications').then((m) => ({ default: m.DriverNotifications })));
const Dashboard = lazy(() => import('@/features/admin/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Fleet = lazy(() => import('@/features/admin/pages/Fleet').then((m) => ({ default: m.Fleet })));
const EmployeesPage = lazy(() => import('@/features/admin/pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })));
const DriversPage = lazy(() => import('@/features/admin/pages/DriversPage').then((m) => ({ default: m.DriversPage })));
const DriverDetail = lazy(() => import('@/features/admin/pages/DriverDetail').then((m) => ({ default: m.DriverDetail })));
const VehiclesPage = lazy(() => import('@/features/admin/pages/VehiclesPage').then((m) => ({ default: m.VehiclesPage })));
const VehicleDetail = lazy(() => import('@/features/admin/pages/VehiclesPage').then((m) => ({ default: m.VehicleDetail })));
const FuelPage = lazy(() => import('@/features/admin/pages/FuelPage').then((m) => ({ default: m.FuelPage })));
const LedgerPage = lazy(() => import('@/features/admin/pages/LedgerPage').then((m) => ({ default: m.LedgerPage })));
const SalariesAdvancesPage = lazy(() => import('@/features/admin/pages/SalariesAdvancesPage').then((m) => ({ default: m.SalariesAdvancesPage })));
const ExpensesPage = lazy(() => import('@/features/admin/pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const PaymentsPage = lazy(() => import('@/features/admin/pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
const DocumentsPage = lazy(() => import('@/features/admin/pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })));
const ReportsPage = lazy(() => import('@/features/admin/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const InboxPage = lazy(() => import('@/features/admin/pages/InboxPage').then((m) => ({ default: m.InboxPage })));
const CalculatorPage = lazy(() => import('@/features/admin/pages/CalculatorPage').then((m) => ({ default: m.CalculatorPage })));
const NotificationsPage = lazy(() => import('@/features/admin/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('@/features/admin/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

function RootRedirect() {
  const role = useApp((s) => s.role);
  const lastRoute = useApp((s) => s.lastRoute);
  // Real mode has one web experience: the office console. Drivers use the phone app.
  if (isApiConfigured()) return <Navigate to="/admin" replace />;
  return <Navigate to={lastRoute[role] || `/${role}`} replace />;
}

/**
 * The public home page. The phone app opens its office console at this very address (`/#handoff=…`,
 * see features/api/handoff), so inside the app "/" goes straight to the console exactly as it always
 * did; only an ordinary browser sees the landing page. The prototype demo (no API) keeps its own entry.
 */
function Home() {
  if (!isApiConfigured()) return <RootRedirect />;
  if (inNativeApp()) return <Navigate to="/admin" replace />;
  return <LandingPage />;
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
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/" element={<Home />} />
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
    </Suspense>
  );
}
