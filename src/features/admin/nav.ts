import {
  ChartColumn,
  Contact,
  Files,
  Fuel,
  HandCoins,
  Inbox,
  Landmark,
  LayoutDashboard,
  Navigation,
  ReceiptIndianRupee,
  ScrollText,
  Settings,
  Truck,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type AdminNavKey =
  | 'dashboard'
  | 'fleet'
  | 'employees'
  | 'allEmployees'
  | 'drivers'
  | 'officeStaff'
  | 'vehicles'
  | 'fuel'
  | 'finance'
  | 'ledger'
  | 'salaries'
  | 'payments'
  | 'expenses'
  | 'documents'
  | 'reports'
  | 'inbox'
  | 'settings'
  | 'calculator'
  | 'notifications';

export interface AdminNavSubItem {
  key: AdminNavKey;
  to: string;
  end?: boolean;
  icon?: LucideIcon;
  badgeKey?: AdminNavKey;
}

export interface AdminNavItem {
  key: AdminNavKey;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  badgeKey?: AdminNavKey;
  children?: AdminNavSubItem[];
}

export const ADMIN_NAV: AdminNavItem[] = [
  { key: 'dashboard', to: '/admin', icon: LayoutDashboard, end: true },
  { key: 'fleet', to: '/admin/fleet', icon: Navigation, badgeKey: 'fleet' },
  {
    key: 'employees',
    to: '/admin/employees',
    icon: Users,
    children: [
      { key: 'allEmployees', to: '/admin/employees', end: true, icon: Contact },
      { key: 'drivers', to: '/admin/drivers', icon: Users },
      { key: 'officeStaff', to: '/admin/employees/staff', icon: UserCheck },
    ],
  },
  { key: 'vehicles', to: '/admin/vehicles', icon: Truck },
  { key: 'fuel', to: '/admin/fuel', icon: Fuel },
  {
    key: 'finance',
    to: '/admin/finance',
    icon: Landmark,
    children: [
      { key: 'ledger', to: '/admin/finance/ledger', icon: ScrollText },
      { key: 'salaries', to: '/admin/finance/salaries', icon: HandCoins },
      { key: 'payments', to: '/admin/finance/payments', icon: Wallet, badgeKey: 'payments' },
      { key: 'expenses', to: '/admin/finance/expenses', icon: ReceiptIndianRupee },
    ],
  },
  { key: 'documents', to: '/admin/documents', icon: Files, badgeKey: 'documents' },
  { key: 'reports', to: '/admin/reports', icon: ChartColumn },
  { key: 'inbox', to: '/admin/inbox', icon: Inbox, badgeKey: 'inbox' },
  { key: 'settings', to: '/admin/settings', icon: Settings },
];

export const MOBILE_NAV: AdminNavKey[] = ['dashboard', 'fleet', 'employees', 'finance'];
