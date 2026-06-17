import { useState } from 'react';
import { useSavedCartsStore } from '@/stores/savedCarts.store';
import { useCartStore } from '@/stores/cart.store';
import { Plus, Trash2, X } from 'lucide-react';
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
      <div className={cn("h-10 w-full border-b border-border bg-background flex items-center px-2 z-10 shrink-0 transition-all", pulse && "bg-accent/10")}>
        <div className="flex-1 flex gap-1.5 h-full items-end overflow-x-auto no-scrollbar">
          {activeCartId === 'default' && items.length > 0 && (
            <div 
              className="h-8 min-w-[90px] px-2.5 flex items-center justify-center rounded-t-lg bg-surface border-border border-t border-x cursor-pointer shrink-0"
              onClick={() => {}}
            >
              <span className={cn("text-xs font-medium", "text-accent")}>الحالية</span>
              {items.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-danger ms-1.5" />}
            </div>
          )}
          {savedCarts.map(cart => {
            const isActive = activeCartId === cart.id;
            return (
              <div 
                key={cart.id}
                onClick={() => switchToCart(cart.id)}
                className={cn(
                  "h-8 min-w-[90px] px-2.5 flex items-center justify-between rounded-t-lg cursor-pointer transition-colors shrink-0",
                  isActive 
                    ? "bg-white border-b-2 border-b-accent text-text" 
                    : "bg-muted text-text-secondary"
                )}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-medium truncate max-w-[80px]">{cart.name}</span>
                  {cart.items.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCartToDelete(cart.id);
                  }}
                  className="p-2.5 -m-2 hover:bg-black/10 rounded-full transition-colors ms-1 shrink-0 text-text-secondary hover:text-danger"
                  title="إلغاء السلة"
                  aria-label="إلغاء السلة"
                  style={{ touchAction: 'manipulation' }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          
          {savedCarts.length < 3 && (
            <button
              onClick={handleAddCart}
              className="h-8 w-8 flex items-center justify-center bg-accent text-white rounded-t-lg font-bold transition-colors hover:bg-accent-hover shrink-0 shadow-sm"
              title="زبون جديد"
              aria-label="زبون جديد"
              style={{ touchAction: 'manipulation' }}
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
        {itemCount !== undefined && itemCount > 0 && onClearCart && (
          <button
            onClick={onClearCart}
            className="w-8 h-8 flex items-center justify-center text-danger hover:bg-danger/10 rounded-full transition-colors ms-1.5"
            style={{ touchAction: 'manipulation' }}
            title="مسح السلة"
            aria-label="مسح السلة"
          >
            <Trash2 className="w-4.5 h-4.5" />
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
