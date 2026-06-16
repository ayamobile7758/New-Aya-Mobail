import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Persisted default for the POS cart sidebar:
//   always → cart is shown docked by default (where the screen has room)
//   hidden → cart starts closed; the user opens it on demand via the cart button
export type CartVisibility = 'always' | 'hidden';

interface UIState {
  sideRailMode: 'auto' | 'collapsed';
  setSideRailMode: (mode: 'auto' | 'collapsed') => void;
  posGridColumns: number;
  setPosGridColumns: (cols: number) => void;
  cartVisibility: CartVisibility;
  setCartVisibility: (mode: CartVisibility) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sideRailMode: 'auto',
      setSideRailMode: (mode) => set({ sideRailMode: mode }),
      posGridColumns: 5,
      setPosGridColumns: (cols) => set({ posGridColumns: cols }),
      cartVisibility: 'always',
      setCartVisibility: (mode) => set({ cartVisibility: mode }),
    }),
    {
      name: 'pos-ui-store',
      partialize: (state) => ({
        posGridColumns: state.posGridColumns,
        cartVisibility: state.cartVisibility,
      }),
    }
  )
);
