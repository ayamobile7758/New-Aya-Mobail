import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  sideRailMode: 'auto' | 'collapsed';
  setSideRailMode: (mode: 'auto' | 'collapsed') => void;
  posGridColumns: number;
  setPosGridColumns: (cols: number) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sideRailMode: 'auto',
      setSideRailMode: (mode) => set({ sideRailMode: mode }),
      posGridColumns: 5,
      setPosGridColumns: (cols) => set({ posGridColumns: cols }),
    }),
    {
      name: 'pos-ui-store',
      partialize: (state) => ({ posGridColumns: state.posGridColumns }),
    }
  )
);
