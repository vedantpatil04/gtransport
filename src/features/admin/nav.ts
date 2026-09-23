import { Bell, Calculator, ChartColumn, Contact, Files, Fuel, LayoutDashboard, Navigation, ReceiptIndianRupee, Settings, Truck, Users, Wallet, type LucideIcon } from 'lucide-react';

export type AdminNavKey = 'dashboard' | 'fleet' | 'employees' | 'drivers' | 'vehicles' | 'fuel' | 'expenses' | 'payments' | 'documents' | 'reports' | 'calculator' | 'notifications' | 'settings';

export const ADMIN_NAV: { key: AdminNavKey; to: string; icon: LucideIcon; end?: boolean }[] = [
  { key: 'dashboard', to: '/admin', icon: LayoutDashboard, end: true },
  { key: 'fleet', to: '/admin/fleet', icon: Navigation },
  { key: 'employees', to: '/admin/employees', icon: Contact },
  { key: 'drivers', to: '/admin/drivers', icon: Users },
  { key: 'vehicles', to: '/admin/vehicles', icon: Truck },
  { key: 'fuel', to: '/admin/fuel', icon: Fuel },
  { key: 'expenses', to: '/admin/expenses', icon: ReceiptIndianRupee },
  { key: 'payments', to: '/admin/payments', icon: Wallet },
  { key: 'documents', to: '/admin/documents', icon: Files },
  { key: 'reports', to: '/admin/reports', icon: ChartColumn },
  { key: 'calculator', to: '/admin/calculator', icon: Calculator },
  { key: 'notifications', to: '/admin/notifications', icon: Bell },
  { key: 'settings', to: '/admin/settings', icon: Settings },
];

export const MOBILE_NAV: AdminNavKey[] = ['dashboard', 'fleet', 'fuel', 'payments'];
