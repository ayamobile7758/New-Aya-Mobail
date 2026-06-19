import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProductGrid } from "./components/ProductGrid";
import { CartSidebar } from "./components/CartSidebar";
import { useCartStore } from "@/stores/cart.store";
import { useUIStore } from "@/stores/ui.store";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { ShoppingCart, X, Minimize2 } from "lucide-react";

import { MaintenancePinDialog } from "@/components/auth/MaintenancePinDialog";
import { AddExpenseDialog } from "./components/AddExpenseDialog";

export default function POSPage() {
  const navigate = useNavigate();
  const { items, pulseTrigger } = useCartStore();
  const { cartVisibility } = useUIStore();
  const [pulse, setPulse] = useState(false);
  const [showMaintDialog, setShowMaintDialog] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);

  // A phone is too narrow for a side-by-side cart, so there the cart always opens
  // as a full-screen overlay. Wider screens (≥640px) open it as a sliding side panel.
  const canDockCart = useMediaQuery('(min-width: 640px)');

  // Temporary, session-only open/close state. It is seeded from the persisted
  // preference (always → open, hidden → closed) but is NOT written back, so toggling
  // the cart in POS never changes the saved default. A fresh launch re-seeds it.
  const [cartOpen, setCartOpen] = useState(cartVisibility === 'always');

  useEffect(() => {
    if (pulseTrigger > 0) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 300);
      return () => clearTimeout(t);
    }
  }, [pulseTrigger]);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  // The cart is "docked" (pushes products aside) only in the persisted always-mode on a
  // wide screen. Otherwise an open cart floats above the products as an overlay/side panel.
  const isDocked = cartOpen && cartVisibility === 'always' && canDockCart;
  const isOverlayOpen = cartOpen && !isDocked;

  return (
    <div className="h-full flex relative overflow-hidden bg-background">

      {/* ── Docked Cart Sidebar — RIGHT side (first in RTL flex), always-mode only ── */}
      {isDocked && (
        <div className="flex w-[300px] md:w-[320px] lg:w-[360px] shrink-0 h-full border-e border-border bg-surface shadow-[4px_0_15px_-5px_rgba(0,0,0,0.05)] z-10 flex-col">
          <CartSidebar onHideCart={() => setCartOpen(false)} />
        </div>
      )}

      {/* ── Main Products Area — fills remaining space, LEFT side ── */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden min-h-0">
          <ProductGrid
            onAddExpense={() => setShowAddExpense(true)}
            onShowMaint={() => setShowMaintDialog(true)}
          />
        </div>
      </div>

      {/* ── Floating cart toggle — always visible at the bottom-start corner. In an RTL
             layout `start` is the RIGHT side, so this sits at bottom-right. One button
             toggles the cart: a cart icon to OPEN, a minimize icon to CLOSE. On every
             device the button stays anchored at the bottom-right corner (no longer lifted
             above the docked cart) so closing the cart is always in the same spot.
             The admin-exit button uses `end` (left in RTL), so the two never overlap. ── */}
      {!cartOpen && (
        <button
          onClick={() => setCartOpen(o => !o)}
          className={cn(
            "absolute start-2 w-14 h-14 bg-accent text-white rounded-full shadow-lg flex items-center justify-center z-[55] hover:opacity-90 transition-all",
            // When the cart is OPEN, sit at the very bottom-right corner, level with the
            // "إتمام البيع" button. When CLOSED, lift it above the bottom nav bar.
            cartOpen
              ? "bottom-[calc(env(safe-area-inset-bottom)+0.5rem)]"
              : "bottom-[calc(env(safe-area-inset-bottom)+60px+0.5rem)] md:bottom-[calc(env(safe-area-inset-bottom)+0.5rem)]",
            pulse && "scale-110"
          )}
          style={{ touchAction: 'manipulation' }}
          aria-label={cartOpen ? "إخفاء السلة" : "إظهار السلة"}
          title={cartOpen ? "إخفاء السلة" : "إظهار السلة"}
        >
          <div className="relative">
            {cartOpen ? (
              <Minimize2 className="w-6 h-6" />
            ) : (
              <>
                <ShoppingCart className="w-6 h-6" />
                {totalItems > 0 && (
                  <span className="absolute -top-2.5 -end-2.5 bg-text-primary text-white text-[11px] min-w-[20px] h-5 px-1 flex items-center justify-center rounded-full border-2 border-background">
                    {totalItems}
                  </span>
                )}
              </>
            )}
          </div>
        </button>
      )}

      {/* ── Cart Overlay — full-screen on phones, sliding side panel on wider screens ── */}
      {isOverlayOpen && (
        <>
          {/* Backdrop (wider screens only — lets a tap outside close the panel) */}
          {canDockCart && (
            <div
              className="fixed inset-0 z-40 bg-black/30 animate-in fade-in"
              onClick={() => setCartOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={cn(
              "z-50 bg-background flex flex-col",
              canDockCart
                ? "fixed inset-y-0 end-0 w-[340px] lg:w-[380px] border-s border-border shadow-[-8px_0_24px_-8px_rgba(0,0,0,0.18)] animate-in slide-in-from-right"
                : "fixed inset-0 animate-in slide-in-from-bottom"
            )}
          >
            <div className="p-3 flex items-center justify-between border-b border-border bg-surface shrink-0 gap-2">
              <button
                onClick={() => setCartOpen(false)}
                className="flex items-center gap-1.5 h-9 px-3 bg-muted hover:bg-border rounded-lg text-sm font-bold text-text-primary transition-colors shrink-0"
                style={{ touchAction: 'manipulation', fontFamily: 'Tajawal, sans-serif' }}
              >
                <X className="w-4 h-4" />
                متابعة التسوق
              </button>
              <h2 className="text-base font-bold" style={{ fontFamily: 'Tajawal, sans-serif' }}>السلة</h2>
            </div>
            <div className="flex-1 overflow-hidden">
              <CartSidebar onHideCart={() => setCartOpen(false)} />
            </div>
          </div>
        </>
      )}

      <MaintenancePinDialog
        isOpen={showMaintDialog}
        onClose={() => setShowMaintDialog(false)}
        onSuccess={() => {
          setShowMaintDialog(false);
          navigate('/maintenance');
        }}
      />

      <AddExpenseDialog
        isOpen={showAddExpense}
        onClose={() => setShowAddExpense(false)}
      />
    </div>
  );
}
