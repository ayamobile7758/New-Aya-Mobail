import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProductGrid } from "./components/ProductGrid";
import { CartSidebar } from "./components/CartSidebar";
import { SavedCartsTabs } from "./components/SavedCartsTabs";
import { useCartStore } from "@/stores/cart.store";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ShoppingCart, X, Home, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function POSPage() {
  const navigate = useNavigate();
  const { accessLevel, requireAdminAction } = useAuth();
  const [showMobileCart, setShowMobileCart] = useState(false);
  const { items, getTotal, pulseTrigger } = useCartStore();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (pulseTrigger > 0) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 300);
      return () => clearTimeout(t);
    }
  }, [pulseTrigger]);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="h-full flex relative overflow-hidden bg-background">

      {/* ── Tablet/Desktop Cart Sidebar — 360px, RIGHT side (first in RTL flex) ── */}
      <div className="hidden md:flex md:w-[320px] lg:w-[360px] shrink-0 h-full border-e border-border bg-surface shadow-[4px_0_15px_-5px_rgba(0,0,0,0.05)] z-10 flex-col">
        <CartSidebar />
      </div>

      {/* ── Main Products Area — fills remaining space, LEFT side ── */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">

        {/* ── Top bar: Home button + Admin Elevation + SavedCartsTabs ── */}
        <div className="flex items-center shrink-0 border-b border-border bg-background">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex w-11 h-11 shrink-0 mx-2 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary hover:text-text-primary hover:border-accent transition-colors shadow-sm"
            title="العودة للرئيسية"
            aria-label="العودة للرئيسية"
            style={{ touchAction: 'manipulation', userSelect: 'none', minWidth: 44, minHeight: 44 }}
          >
            <Home className="w-5 h-5" />
          </button>
          {accessLevel === 'pos' && (
            <button
              onClick={() => requireAdminAction(() => navigate('/dashboard'))}
              className="flex items-center gap-1.5 px-3 h-11 shrink-0 border border-border rounded-lg bg-surface hover:text-accent hover:border-accent text-text-secondary hover:text-text-primary transition-colors shadow-sm text-sm font-bold"
              style={{ touchAction: 'manipulation', fontFamily: 'Tajawal, sans-serif' }}
              title="دخول المدير"
            >
              <Shield className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">دخول المدير</span>
            </button>
          )}
          <div className="flex-1 min-w-0 border-s border-border">
            <SavedCartsTabs />
          </div>
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          <ProductGrid />
        </div>
      </div>

      {/* ── Mobile Cart Button (phones only, < 768px) ── */}
      {!showMobileCart && totalItems > 0 && (
        <button
          onClick={() => setShowMobileCart(true)}
          className={cn(
            "md:hidden absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] start-0 end-0 mx-auto w-fit bg-text-primary text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-3 font-bold z-20 animate-in slide-in-from-bottom transition-transform",
            pulse && "scale-110"
          )}
          style={{ touchAction: 'manipulation' }}
        >
          <div className="relative">
            <ShoppingCart className="w-6 h-6" />
            <span className="absolute -top-2 -end-2 bg-accent text-white text-xs w-5 h-5 flex items-center justify-center rounded-full">
              {totalItems}
            </span>
          </div>
          <span>عرض السلة</span>
          <span className="numeric ms-2 border-s border-white/20 ps-4">
            {formatMoney(getTotal())}
          </span>
        </button>
      )}

      {/* ── Mobile Cart Overlay — bottom sheet on phones ── */}
      {showMobileCart && (
        <div className="md:hidden fixed inset-0 z-50 bg-background flex flex-col animate-in slide-in-from-bottom">
          <div className="p-3 flex items-center justify-between border-b border-border bg-surface shrink-0 gap-2">
            <button
              onClick={() => setShowMobileCart(false)}
              className="flex items-center gap-1.5 h-9 px-3 bg-muted hover:bg-border rounded-lg text-sm font-bold text-text-primary transition-colors shrink-0"
              style={{ touchAction: 'manipulation', fontFamily: 'Tajawal, sans-serif' }}
            >
              <X className="w-4 h-4" />
              متابعة التسوق
            </button>
            <h2 className="text-base font-bold" style={{ fontFamily: 'Tajawal, sans-serif' }}>السلة</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <CartSidebar />
          </div>
        </div>
      )}
    </div>
  );
}
