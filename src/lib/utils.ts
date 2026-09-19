import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const uid = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

export const sum = <T,>(items: T[], pick: (item: T) => number) => items.reduce((acc, it) => acc + pick(it), 0);

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** Loose match used by search: case-insensitive, ignores spaces and dashes. */
export const normalize = (s: string) => s.toLowerCase().replace(/[\s\-–.,/]/g, '');
