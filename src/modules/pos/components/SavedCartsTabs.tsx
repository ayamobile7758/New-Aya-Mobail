import { useState } from 'react';
import { useSavedCartsStore } from '@/stores/savedCarts.store';
import { useCartStore } from '@/stores/cart.store';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/ui/Dialog';

interface SavedCartsTabsProps {
  itemCount?: number;
  onClearCart?: () => void;
  pulse?: boolean;
}

export function SavedCartsTabs({ itemCount, onClearCart, pulse }: SavedCartsTabsProps) {
  const { savedCarts, deleteCart } = useSavedCartsStore();
  const { activeCartId, switchToCart, items } = useCartStore();
  
  const [cartToDelete, setCartToDelete] = useState<string | null>(null);

  // Long press logic
  let pressTimer: ReturnType<typeof setTimeout>;
  
  const handleTouchStart = (id: string) => {
    pressTimer = setTimeout(() => {
      setCartToDelete(id);
    }, 500);
  };
  
  const handleTouchEnd = () => {
    clearTimeout(pressTimer);
  };

  const handleAddCart = () => {
    if (savedCarts.length >= 3) return;
    
    const newName = `سلة ${new Date().toLocaleTimeString('ar-IQ', {hour: '2-digit', minute:'2-digit'})}`;
    
    const res = useSavedCartsStore.getState().saveCart(newName, [], 'amount', 0);
    if (res.success && res.newCartId) {
      switchToCart(res.newCartId);
    }
  };

  const handleDelete = () => {
    if (cartToDelete) {
      deleteCart(cartToDelete);
      if (activeCartId === cartToDelete) {
        const remaining = useSavedCartsStore.getState().savedCarts;
        if (remaining.length > 0) {
          switchToCart(remaining[0].id);
        } else {
          switchToCart('default');
        }
      }
      setCartToDelete(null);
    }
  };

  return (
    <>
      <div className={cn("h-12 w-full border-b border-border bg-background flex items-center px-2 z-10 shrink-0 transition-all", pulse && "bg-accent/10")}>
        <div className="flex-1 flex gap-2 h-full items-end overflow-x-auto no-scrollbar">
          {activeCartId === 'default' && items.length > 0 && (
            <div 
              className="h-10 min-w-[100px] px-4 flex items-center justify-center rounded-t-lg bg-surface border-border border-t border-x cursor-pointer shrink-0"
              onClick={() => {}}
            >
              <span className={cn("text-sm font-medium", "text-[#CF694A]")}>الحالية (غير محفوظة)</span>
              {items.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-danger ms-2" />}
            </div>
          )}
          {savedCarts.map(cart => {
            const isActive = activeCartId === cart.id;
            return (
              <div 
                key={cart.id}
                onMouseDown={() => handleTouchStart(cart.id)}
                onMouseUp={handleTouchEnd}
                onMouseLeave={handleTouchEnd}
                onTouchStart={() => handleTouchStart(cart.id)}
                onTouchEnd={handleTouchEnd}
                onClick={() => switchToCart(cart.id)}
                className={cn(
                  "h-10 min-w-[100px] px-4 flex items-center justify-center rounded-t-lg cursor-pointer transition-colors shrink-0",
                  isActive 
                    ? "bg-white border-b-[3px] border-b-[#CF694A] text-text" 
                    : "bg-[#F3F1EC] text-[#6D6A62] pb-[3px]"
                )}
              >
                <span className="text-sm font-medium truncate max-w-[120px]">{cart.name}</span>
                {cart.items.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-danger ms-2 shrink-0" />}
              </div>
            );
          })}
          
          {savedCarts.length < 3 && (
            <button
              onClick={handleAddCart}
              className="h-10 w-10 flex items-center justify-center bg-accent text-white rounded-t-lg font-bold transition-colors hover:bg-accent-hover shrink-0 mb-[3px] shadow-sm"
              title="زبون جديد"
              aria-label="زبون جديد"
              style={{ touchAction: 'manipulation' }}
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>
        {itemCount !== undefined && itemCount > 0 && onClearCart && (
          <button
            onClick={onClearCart}
            className="w-10 h-10 flex items-center justify-center text-danger hover:bg-danger/10 rounded-full transition-colors ms-2"
            style={{ touchAction: 'manipulation' }}
            title="مسح السلة"
            aria-label="مسح السلة"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      <Dialog isOpen={cartToDelete !== null} onClose={() => setCartToDelete(null)} title="تأكيد الإغلاق">
        <p className="mb-6">هل أنت متأكد من إغلاق هذه السلة وحذف محتوياتها؟</p>
        <div className="flex gap-3">
          <button 
            onClick={handleDelete}
            className="flex-1 h-11 bg-danger text-white font-bold rounded-lg"
          >
            إغلاق وحذف
          </button>
          <button 
            onClick={() => setCartToDelete(null)}
            className="flex-1 h-11 bg-surface border border-border rounded-lg"
          >
            إلغاء
          </button>
        </div>
      </Dialog>
    </>
  );
}
