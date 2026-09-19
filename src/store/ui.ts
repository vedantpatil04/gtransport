import { create } from 'zustand';

/** Transient UI state that must not persist across reloads. */
interface UiStore {
  sync: 'idle' | 'syncing' | 'synced';
  syncedCount: number;
  setSync: (sync: UiStore['sync'], syncedCount?: number) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  calculatorOpen: boolean;
  setCalculatorOpen: (open: boolean) => void;
  /** Id of a fuel entry created in this session — highlighted on the admin dashboard. */
  freshFuelIds: string[];
  markFresh: (id: string) => void;
}

export const useUi = create<UiStore>((set) => ({
  sync: 'idle',
  syncedCount: 0,
  setSync: (sync, syncedCount = 0) => set({ sync, syncedCount }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  calculatorOpen: false,
  setCalculatorOpen: (calculatorOpen) => set({ calculatorOpen }),
  freshFuelIds: [],
  markFresh: (id) => set((s) => ({ freshFuelIds: [...s.freshFuelIds, id] })),
}));
