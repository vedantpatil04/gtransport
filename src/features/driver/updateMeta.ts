import { Cog, Ellipsis, Fuel, HandCoins, Route, SquareParking, Ticket, UtensilsCrossed, Wrench, type LucideIcon } from 'lucide-react';
import type { UpdateType } from '@/types';

export type AnyCategory = UpdateType | 'fuel';

/** Icon + colour per update type. Colours are muted so fuel stays the loudest action. */
export const UPDATE_META: Record<AnyCategory, { icon: LucideIcon; tint: string }> = {
  fuel: { icon: Fuel, tint: 'bg-primary text-white' },
  toll: { icon: Ticket, tint: 'bg-[#e8eef7] text-[#1f4a86] dark:bg-[#1c2a3d] dark:text-[#9dbbe6]' },
  parking: { icon: SquareParking, tint: 'bg-[#e6f0f6] text-[#1d5f86] dark:bg-[#18303d] dark:text-[#8cc3e3]' },
  repair: { icon: Wrench, tint: 'bg-[#f6ece4] text-[#8a4a17] dark:bg-[#3a281a] dark:text-[#e5b184]' },
  food: { icon: UtensilsCrossed, tint: 'bg-[#f5efdc] text-[#7a5a06] dark:bg-[#352c14] dark:text-[#e3c56f]' },
  advance: { icon: HandCoins, tint: 'bg-success-soft text-success' },
  trip: { icon: Route, tint: 'bg-[#eeeaf5] text-[#553d85] dark:bg-[#2a2338] dark:text-[#c2afe6]' },
  maintenance: { icon: Cog, tint: 'bg-[#ebeef1] text-[#3f4b59] dark:bg-[#232b35] dark:text-[#b3bfcc]' },
  other: { icon: Ellipsis, tint: 'bg-[#ebeef1] text-[#3f4b59] dark:bg-[#232b35] dark:text-[#b3bfcc]' },
};
