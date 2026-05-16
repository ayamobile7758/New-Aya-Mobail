import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, PackageSearch } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getActiveProducts, Product } from '@/db/queries/products';
import { getCategories } from '@/db/queries/categories';
import { useCartStore } from '@/stores/cart.store';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { loadProductImage } from '@/lib/imageStorage';
import { useDebounce } from '@/hooks/useDebounce';
import { getProductIcon } from '@/lib/iconMap';

export function ProductGrid() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 150);
  const [category, setCategory] = useState('all');
  const { addItem } = useCartStore();

  const { data: dbCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(true),
    staleTime: Infinity,
  });

  const allTab = { id: 'all', label: 'الكل', color: '#CF694A' };
  const categoryTabs = [
    allTab,
    ...dbCategories.map(c => ({ id: c.id, label: c.name, color: c.color })),
  ];

  const catColorMap = Object.fromEntries(dbCategories.map(c => [c.id, c.color]));

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', 'active', debouncedSearch, category],
    queryFn: () => getActiveProducts(debouncedSearch, category),
    staleTime: Infinity,
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    if (!parentRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w >= 1280) setColumns(5);
        else if (w >= 1024) setColumns(4);
        else if (w >= 768) setColumns(3);
        else setColumns(2);
      }
    });
    observer.observe(parentRef.current);
    return () => observer.disconnect();
  }, []);

  const rowCount = Math.ceil((products?.length || 0) / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 178,
    overscan: 5,
  });

  const clearFilters = useCallback(() => {
    setSearch('');
    setCategory('all');
  }, []);

  const hasFilters = search !== '' || category !== 'all';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filters Header */}
      <div className="p-4 bg-background shrink-0">
        <div className="relative mb-4">
          <input
            type="text"
            placeholder="بحث عن منتج برمز SKU أو الاسم..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="البحث في المنتجات"
            className="w-full h-[var(--input-height)] ps-10 pe-4 rounded-lg border border-border bg-surface focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
          />
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" aria-hidden="true" />
        </div>

        <div className="flex overflow-x-auto no-scrollbar" role="tablist" aria-label="تصفية حسب الفئة">
          {categoryTabs.map((cat) => {
            const isActive = category === cat.id;
            return (
              <button
                key={cat.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setCategory(cat.id)}
                style={{
                  backgroundColor: cat.color,
                  opacity: isActive ? 1 : 0.55,
                  boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
                  borderBottom: isActive ? '3px solid #fff' : '3px solid transparent',
                  touchAction: 'manipulation',
                  userSelect: 'none',
                }}
                className="flex-1 min-w-[80px] h-[60px] flex items-center justify-center whitespace-nowrap text-white font-bold rounded-t-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
                dir="rtl"
              >
                <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '15px', fontWeight: 700 }}>
                  {cat.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      <div ref={parentRef} className="flex-1 overflow-y-auto p-4 content-start pb-24 lg:pb-4">
        {isLoading ? (
          <div className="flex justify-center py-8" aria-live="polite" aria-label="جاري التحميل">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16 text-text-secondary flex flex-col items-center gap-3" role="status">
            <PackageSearch className="w-14 h-14 opacity-25 text-text-secondary" aria-hidden="true" />
            <div>
              <p className="font-semibold text-text-primary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                {hasFilters ? 'لا توجد نتائج مطابقة' : 'لا توجد منتجات بعد'}
              </p>
              <p className="text-sm mt-1 text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                {hasFilters
                  ? 'جرّب تغيير كلمة البحث أو الفئة'
                  : 'أضف منتجاتك من قسم المنتجات'}
              </p>
            </div>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="mt-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                style={{ fontFamily: 'Tajawal, sans-serif' }}
              >
                مسح التصفية
              </button>
            )}
          </div>
        ) : (
          <div
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const startIndex = virtualRow.index * columns;
              const rowProducts = products.slice(startIndex, startIndex + columns);
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: '10px',
                  }}
                  className="flex gap-[10px]"
                >
                  {rowProducts.map(product => (
                    <div key={product.id} style={{ width: `${100 / columns}%` }} className="h-full">
                      <ProductCard
                        product={product}
                        onAdd={() => addItem(product)}
                        categoryColor={catColorMap[product.category]}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

function ProductCard({ product, onAdd, categoryColor }: { product: Product; onAdd: () => void; categoryColor?: string }) {
  const isOutOfStock = product.track_stock && product.stock_qty <= 0;
  const isLowStock = product.track_stock && product.stock_qty > 0 && product.stock_qty <= product.min_stock;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [floatPluses, setFloatPluses] = useState<{ id: number; x: number; y: number }[]>([]);
  const floatIdCounter = useRef(0);
  const lastTapTime = useRef(0);

  useEffect(() => {
    let active = true;
    if (product.image_path) {
      loadProductImage(product.image_path).then(url => {
        if (active && url) setImageUrl(url);
      });
    }
    return () => { active = false; };
  }, [product.image_path]);

  const color = (() => {
    if (categoryColor && /^#[0-9A-Fa-f]{6}$/.test(categoryColor)) {
      const { r, g, b } = hexToRgb(categoryColor);
      return { bg: `rgba(${r},${g},${b},0.10)`, text: categoryColor };
    }
    return { bg: '#F3F1EC', text: '#6D6A62' };
  })();
  const IconComponent = getProductIcon(product.icon);

  const triggerAdd = () => {
    if (isOutOfStock) return;
    const now = Date.now();
    if (now - lastTapTime.current < 80) return;
    lastTapTime.current = now;
    onAdd();
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 100);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    triggerAdd();
    const rect = e.currentTarget.getBoundingClientRect();
    const id = floatIdCounter.current++;
    setFloatPluses(prev => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    setTimeout(() => setFloatPluses(prev => prev.filter(p => p.id !== id)), 600);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      triggerAdd();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={isOutOfStock}
      aria-label={`إضافة ${product.name}، السعر ${formatMoney(product.sale_price)}${isOutOfStock ? '، نفذت الكمية' : ''}`}
      style={{ touchAction: 'manipulation', userSelect: 'none', height: '168px' }}
      className={cn(
        "bg-surface border border-border rounded-xl flex flex-col select-none relative overflow-hidden text-start w-full",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
        isOutOfStock ? "opacity-60 grayscale cursor-not-allowed" : "cursor-pointer hover:border-accent",
        isAnimating && "scale-[0.96] transition-transform duration-100",
        !isAnimating && "transition-all"
      )}
    >
      {/* Float +1 animations */}
      {floatPluses.map(fp => (
        <span
          key={fp.id}
          aria-hidden="true"
          className="absolute z-10 text-[#CF694A] font-bold text-xl pointer-events-none animate-float-up"
          style={{ left: fp.x, top: fp.y, fontFamily: 'Inter' }}
        >
          +1
        </span>
      ))}

      {/* Image / Icon area — 88px */}
      <div className="h-[88px] w-full shrink-0 overflow-hidden rounded-t-xl">
        {imageUrl ? (
          <img src={imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ backgroundColor: color.bg, color: color.text }}
            aria-hidden="true"
          >
            <IconComponent size={40} opacity={0.85} />
          </div>
        )}
      </div>

      {/* Text area */}
      <div className="flex flex-col justify-between flex-1 px-2 pt-1 pb-2 min-h-0">
        <h3
          className="line-clamp-2 leading-tight text-text-primary"
          style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '13px', fontWeight: 600 }}
        >
          {product.name}
        </h3>

        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-0.5">
            {product.track_stock && isOutOfStock && (
              <span className="flex items-center gap-0.5" style={{ fontSize: '10px', color: 'var(--color-danger)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block" aria-hidden="true" />نفذت
              </span>
            )}
            {product.track_stock && isLowStock && (
              <span className="flex items-center gap-0.5" style={{ fontSize: '10px', color: 'var(--color-warning)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" aria-hidden="true" />{product.stock_qty}
              </span>
            )}
          </div>
          <span
            className="numeric"
            style={{ fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: 700, color: '#CF694A' }}
            aria-hidden="true"
          >
            {formatMoney(product.sale_price)}
          </span>
        </div>
      </div>
    </button>
  );
}
