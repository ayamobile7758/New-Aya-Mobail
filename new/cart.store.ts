// src/stores/cart.store.ts
// =============================================================================
// BUNDLE 3 — POS & Cart UX (NEW-1: persist activeCartId in localStorage)
// HEAD: b6c491e
//
// FIX SUMMARY:
//   - Add `activeCartId` to the `partialize` function so the ID of the
//     currently-active saved cart survives a page reload.
//   - Without this fix: after reload, `activeCartId` resets to 'default' even
//     though `items` are still Cart A's items. Edits to those items silently
//     stop syncing back to Cart A in savedCarts.store (because
//     `syncToSavedCart` checks `if (state.activeCartId !== 'default')`).
//   - With this fix: `activeCartId` is restored after reload, so subsequent
//     edits continue to sync to Cart A correctly.
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { Product } from '@/db/queries/products';
import { addMoney, subMoney, mulMoney, applyPercent } from '@/lib/money';
import { useSavedCartsStore } from './savedCarts.store';

export interface CartItem {
  cartItemId: string;
  product: Product;
  quantity: number;
  discountType: 'amount' | 'percent';
  discountValue: number;
  overridePrice?: number;
  isGift: boolean;
}

interface CartState {
  activeCartId: string;
  items: CartItem[];
  globalDiscountType: 'amount' | 'percent';
  globalDiscountValue: number;
  pulseTrigger: number;

  addItem: (product: Product) => void;
  restoreItem: (item: CartItem) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, qty: number) => void;
  setItemDiscount: (cartItemId: string, type: 'amount' | 'percent', value: number) => void;
  setItemPrice: (cartItemId: string, priceInFils: number) => void;
  setItemGift: (cartItemId: string, isGift: boolean) => void;
  setGlobalDiscount: (type: 'amount' | 'percent', value: number) => void;
  clearCart: () => void;
  switchToCart: (savedCartId: string) => void;
  saveAsNewCart: (title: string) => void;
  syncToSavedCart: () => void;

  getSubtotal: () => number;
  getTotalDiscount: () => number;
  getTotal: () => number;
}

export function calculateItemLineTotal(item: CartItem): { subtotal: number; discountAmt: number; total: number } {
  const unitPrice = item.overridePrice !== undefined ? item.overridePrice : item.product.sale_price;
  const sub = mulMoney(unitPrice, item.quantity);

  if (item.isGift) {
    return { subtotal: sub, discountAmt: sub, total: 0 };
  }

  let dAmt = 0;
  if (item.discountType === 'amount') {
    dAmt = item.discountValue;
  } else {
    dAmt = applyPercent(sub, item.discountValue);
  }
  if (dAmt > sub) dAmt = sub;
  return { subtotal: sub, discountAmt: dAmt, total: subMoney(sub, dAmt) };
}

function safeSyncLater(getFn: () => CartState) {
  setTimeout(() => {
    try { getFn().syncToSavedCart(); } catch (_) {}
  }, 0);
}

function haptic() {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(30);
    }
  } catch (_) {}
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      activeCartId: 'default',
      items: [],
      globalDiscountType: 'amount',
      globalDiscountValue: 0,
      pulseTrigger: 0,

      syncToSavedCart: () => {
        const state = get();
        if (state.activeCartId !== 'default') {
          try {
            useSavedCartsStore.getState().updateCart(
              state.activeCartId,
              state.items,
              state.globalDiscountType,
              state.globalDiscountValue
            );
          } catch (_) {}
        }
      },

      switchToCart: (savedCartId: string) => {
        if (savedCartId === 'default') {
          set({ activeCartId: 'default', items: [], globalDiscountType: 'amount', globalDiscountValue: 0 });
          return;
        }
        const savedCartsStore = useSavedCartsStore.getState();
        const cart = savedCartsStore.savedCarts.find(c => c.id === savedCartId);
        if (cart) {
          set({
            activeCartId: cart.id,
            items: [...cart.items],
            globalDiscountType: cart.globalDiscountType,
            globalDiscountValue: cart.globalDiscountValue,
          });
        }
      },

      saveAsNewCart: (title: string) => {
        const state = get();
        const savedCartsStore = useSavedCartsStore.getState();
        const res = savedCartsStore.saveCart(title, state.items, state.globalDiscountType, state.globalDiscountValue);
        if (res.success && res.newCartId) {
          set({ activeCartId: res.newCartId });
        }
      },

      addItem: (product) => set((state) => {
        haptic();
        const nextPulse = state.pulseTrigger + 1;
        const existingIndex = state.items.findIndex(
          i => i.product.id === product.id && i.discountValue === 0 && !i.overridePrice && !i.isGift
        );
        let newItems;
        if (existingIndex >= 0) {
          newItems = [...state.items];
          newItems[existingIndex] = { ...newItems[existingIndex], quantity: newItems[existingIndex].quantity + 1 };
        } else {
          const newItem: CartItem = {
            cartItemId: nanoid(),
            product,
            quantity: 1,
            discountType: 'amount',
            discountValue: 0,
            isGift: false,
          };
          newItems = [...state.items, newItem];
        }
        safeSyncLater(get);
        return { items: newItems, pulseTrigger: nextPulse };
      }),

      restoreItem: (item) => set((state) => {
        const nextPulse = state.pulseTrigger + 1;
        const newItems = [...state.items, item];
        safeSyncLater(get);
        return { items: newItems, pulseTrigger: nextPulse };
      }),

      removeItem: (cartItemId) => set((state) => {
        safeSyncLater(get);
        return { items: state.items.filter(i => i.cartItemId !== cartItemId) };
      }),

      updateQuantity: (cartItemId, qty) => set((state) => {
        safeSyncLater(get);
        return {
          items: state.items.map(i =>
            i.cartItemId === cartItemId ? { ...i, quantity: Math.max(1, qty) } : i
          )
        };
      }),

      setItemDiscount: (cartItemId, type, value) => set((state) => {
        safeSyncLater(get);
        return {
          items: state.items.map(i =>
            i.cartItemId === cartItemId
              ? { ...i, discountType: type, discountValue: Math.max(0, value) }
              : i
          )
        };
      }),

      setItemPrice: (cartItemId, priceInFils) => set((state) => {
        safeSyncLater(get);
        return {
          items: state.items.map(i =>
            i.cartItemId === cartItemId ? { ...i, overridePrice: Math.max(0, priceInFils) } : i
          )
        };
      }),

      setItemGift: (cartItemId, isGift) => set((state) => {
        safeSyncLater(get);
        return {
          items: state.items.map(i =>
            i.cartItemId === cartItemId ? { ...i, isGift } : i
          )
        };
      }),

      setGlobalDiscount: (type, value) => {
        set({ globalDiscountType: type, globalDiscountValue: Math.max(0, value) });
        try { get().syncToSavedCart(); } catch (_) {}
      },

      clearCart: () => {
        set({ items: [], globalDiscountType: 'amount', globalDiscountValue: 0 });
        try { get().syncToSavedCart(); } catch (_) {}
      },

      getSubtotal: () => {
        const state = get();
        return state.items.reduce((sum, item) => {
          const unitPrice = item.overridePrice !== undefined ? item.overridePrice : item.product.sale_price;
          return addMoney(sum, mulMoney(unitPrice, item.quantity));
        }, 0);
      },

      getTotalDiscount: () => {
        const state = get();
        // ME-B: client vs server discount distribution
        // Client (this file) computes: sum(per-item discounts) + lump global discount.
        // Server (sales.ts) redistributes the global portion proportionally
        // across non-gift items with last-item-absorbs-rounding. The SUMS are
        // mathematically equal; only the per-item allocation differs. The
        // client formula is sufficient for the displayed cart total.
        const itemsDiscount = state.items.reduce(
          (sum, item) => addMoney(sum, calculateItemLineTotal(item).discountAmt), 0
        );
        const itemsTotal = state.items.reduce(
          (sum, item) => addMoney(sum, calculateItemLineTotal(item).total), 0
        );
        let globalDiscountAmt = 0;
        if (state.globalDiscountType === 'amount') {
          globalDiscountAmt = state.globalDiscountValue;
        } else {
          globalDiscountAmt = applyPercent(itemsTotal, state.globalDiscountValue);
        }
        if (globalDiscountAmt > itemsTotal) globalDiscountAmt = itemsTotal;
        return addMoney(itemsDiscount, globalDiscountAmt);
      },

      getTotal: () => {
        const state = get();
        const subtotal = state.getSubtotal();
        const totalDiscount = state.getTotalDiscount();
        return Math.max(0, subMoney(subtotal, totalDiscount));
      },
    }),
    {
      name: 'active_cart',
      storage: createJSONStorage(() => localStorage),
      // LO-E: localStorage quota risk is accepted for single-shop deployment.
      // Cart size is bounded by typical retail sessions (< 50 items).
      // If a quota error occurs, Zustand will fail silently and the cart will
      // simply not persist across reloads — acceptable degradation.
      partialize: (state) => ({
        // NEW-1: persist activeCartId so saved-cart edits survive page reload.
        // Without this, switching to a saved cart then reloading would reset
        // activeCartId to 'default', and subsequent edits to the (still-loaded)
        // saved-cart items would silently stop syncing back to the saved cart.
        activeCartId: state.activeCartId,
        items: state.items,
        globalDiscountType: state.globalDiscountType,
        globalDiscountValue: state.globalDiscountValue,
      }),
    }
  )
);
