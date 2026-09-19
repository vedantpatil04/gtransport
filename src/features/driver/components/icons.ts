import { CircleEllipsis, Fuel, HandCoins, Hammer, Milestone, Package, SquareParking, Utensils, Wrench, type LucideIcon } from 'lucide-react';
import type { ExpenseCategory, UpdateType } from '@/types';

export const UPDATE_ICON: Record<UpdateType | 'fuel', LucideIcon> = {
  fuel: Fuel,
  toll: Milestone,
  parking: SquareParking,
  repair: Wrench,
  food: Utensils,
  advance: HandCoins,
  trip: Package,
  other: CircleEllipsis,
  maintenance: Hammer,
};

/** Tile colours per update type — muted, distinct, readable in sunlight. */
export const UPDATE_TINT: Record<ExpenseCategory | 'advance' | 'fuel', string> = {
  fuel: 'bg-[#fff4d6] text-[#8a5a00]',
  toll: 'bg-[#e6eefb] text-[#1f4aa8]',
  parking: 'bg-[#e9f0f6] text-[#2d4f73]',
  repair: 'bg-[#fdeceb] text-[#b0352b]',
  food: 'bg-[#fff0e3] text-[#b25a12]',
  advance: 'bg-[#e5f4ea] text-[#1b7a44]',
  trip: 'bg-[#efeaf7] text-[#5b3f93]',
  other: 'bg-[#eef0f2] text-[#4a5563]',
  maintenance: 'bg-[#eef0f2] text-[#4a5563]',
};
