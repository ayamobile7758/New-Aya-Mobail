import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, PackageSearch, LayoutGrid, Shield, Lock, Wrench, Receipt } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getActiveProducts, Product } from '@/db/queries/products';
import { getCategories } from '@/db/queries/categories';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { loadProductImage } from '@/lib/imageStorage';
import { useDebounce } from '@/hooks/useDebounce';
import { getProductIcon } from '@/lib/iconMap';
import { useAuth } from '@/contexts/AuthContext';

const MIN_CARD_PX = 56;
const GAP = 10;
const GRID_PADDING = 32; // p-4 both sides

type SizeLevel = 'full' | 'compact' | 'mini';

function getSizeLevel(w: number): SizeLevel {
  if (w >= 150) return 'full';
  if (w >= 100) return 'compact';
  return 'mini';
}

function getCardHeight(level: SizeLevel): number {
  if (level === 'full')    return 168;
  if (level === 'compact') return 120;
  return 80;
}

interface ProductGridProps {
  onAddExpense: () => void;
  onShowMaint: () => void;
}

export function ProductGrid({ onAddExpense, onShowMaint }: ProductGridProps) {
  const { requireAdminAction, lockNow, accessLevel } = useAuth();
  const [search, setSearch]     = useState('');
  const debouncedSearch          = useDebounce(search, 150);
  const [category, setCategory] = useState('all');
  const { addItem }              = useCartStore();
  const { posGridColumns, setPosGridColumns } = useUIStore();
  const [showDensity, setShowDensity] = useState(false);
  const densityRef = useRef<HTMLDivElement>(null);

  const { data: dbCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(true),
    staleTime: Infinity,
  });

  const categoryTabs = [
    { id: 'all', label: 'الكل', color: '#CF694A' },
    ...dbCategories.map(c => ({ id: c.id, label: c.name, color: c.color })),
  ];
  const catColorMap = Object.fromEntries(dbCategories.map(c => [c.id, c.color]));

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', 'active', debouncedSearch, category],
    queryFn: () => getActiveProducts(debouncedSearch, category),
    staleTime: Infinity,
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(320);

  useEffect(() => {
    if (!parentRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(parentRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!showDensity) return;
    const handler = (e: MouseEvent) => {
      if (densityRef.current && !densityRef.current.contains(e.target as Node))
        setShowDensity(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDensity]);

  const available     = containerWidth - GRID_PADDING;
  const maxCols       = Math.max(1, Math.floor((available + GAP) / (MIN_CARD_PX + GAP)));
  const columns       = Math.min(posGridColumns, maxCols);
  const cardWidth     = (available - GAP * (columns - 1)) / columns;
  const sizeLevel     = getSizeLevel(cardWidth);
  const cardHeight    = getCardHeight(sizeLevel);
  const rowHeight     = cardHeight + GAP;

  const rowCount = Math.ceil((products.length || 0) / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  });

  const navigate     = useNavigate();
  const clearFilters = useCallback(() => { setSearch(''); setCategory('all'); }, []);
  const hasFilters   = search !== '' || category !== 'all';

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header: search + compact buttons ── */}
      <div className="p-4 bg-background shrink-0 border-b border-border">
        <div className="flex items-center gap-2 mb-4" dir="rtl">
          {/* Right side: Lock + Add Expense (rendered first in RTL -> shows on the right) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Lock */}
            <button
              onClick={() => lockNow()}
              className="w-11 h-11 flex items-center justify-center rounded-lg border border-border bg-surface text-text-secondary hover:text-red-500 hover:border-red-400 transition-colors shadow-sm"
              title="قفل النظام"
              aria-label="قفل النظام"
              style={{ touchAction: 'manipulation' }}
            >
              <Lock className="w-5 h-5" />
            </button>

            {/* Add Expense */}
            <button
              onClick={onAddExpense}
              className="w-11 h-11 flex items-center justify-center rounded-lg border border-border bg-surface text-text-secondary hover:text-accent hover:border-accent transition-colors shadow-sm"
              title="إضافة مصروف"
              aria-label="إضافة مصروف"
              style={{ touchAction: 'manipulation' }}
            >
              <Receipt className="w-5 h-5" />
            </button>

            {/* Maintenance */}
            <button
              onClick={onShowMaint}
              className="w-11 h-11 flex items-center justify-center rounded-lg border border-border bg-surface text-text-secondary hover:text-accent hover:border-accent transition-colors shadow-sm"
              title="الصيانة"
              aria-label="الصيانة"
              style={{ touchAction: 'manipulation' }}
            >
              <Wrench className="w-5 h-5" />
            </button>
          </div>

          {/* Middle: Search Input (stretched) */}
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="بحث عن منتج برمز SKU أو الاسم..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="البحث في المنتجات"
              className="w-full h-11 ps-10 pe-4 rounded-lg border border-border bg-surface focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
            />
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" aria-hidden="true" />
          </div>

          {/* Left side: Admin, Maintenance, Density (rendered last in RTL -> shows on the left) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Admin */}
            <button
              onClick={() => {
                if (accessLevel === 'admin') {
                  navigate('/dashboard');
                } else {
                  requireAdminAction(() => {
                    setTimeout(() => navigate('/dashboard'), 0);
                  });
                }
              }}
              className="w-11 h-11 flex items-center justify-center rounded-lg border border-border bg-surface text-text-secondary hover:text-accent hover:border-accent transition-colors shadow-sm"
              title="دخول المدير"
              aria-label="دخول المدير"
              style={{ touchAction: 'manipulation' }}
            >
              <Shield className="w-5 h-5" />
            </button>

            {/* Density popover */}
            <div ref={densityRef} className="relative">
              <button
                onClick={() => setShowDensity(v => !v)}
                aria-label="ضبط كثافة الشبكة"
                aria-expanded={showDensity}
                title="ضبط كثافة الشبكة"
                style={{ touchAction: 'manipulation', userSelect: 'none' }}
                className={cn(
                  "w-11 h-11 flex items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  showDensity
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-text-secondary hover:border-accent hover:text-accent"
                )}
              >
                <LayoutGrid className="w-5 h-5" />
              </button>

              {showDensity && (
                <div
                  className="absolute top-full mt-2 end-0 z-50 bg-surface border border-border rounded-xl shadow-lg p-4 w-64 text-text-primary"
                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-text-primary">عدد المنتجات في الصف</span>
                    <span
                      className="text-2xl font-bold text-accent"
                      style={{ fontFamily: 'Inter, sans-serif', minWidth: 32, textAlign: 'center' }}
                    >
                      {posGridColumns}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={15}
                    step={1}
                    value={posGridColumns}
                    onChange={e => setPosGridColumns(Number(e.target.value))}
                    style={{ touchAction: 'manipulation', accentColor: '#CF694A', minHeight: 44 }}
                    className="w-full cursor-pointer"
                    aria-label="عدد المنتجات في الصف"
                  />
                  <div className="flex justify-between mt-1 text-xs text-text-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
                    <span>3</span>
                    <span>15</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex overflow-x-auto no-scrollbar" role="tablist" aria-label="تصفية حسب الفئة">
          {categoryTabs.map(cat => {
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
                className="flex-1 min-w-[72px] h-[60px] flex items-center justify-center whitespace-nowrap text-white font-bold rounded-t-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
                dir="rtl"
              >
                <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '14px', fontWeight: 700 }}>
                  {cat.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Grid ── */}
      <div ref={parentRef} className="flex-1 overflow-y-auto p-4 pb-24 lg:pb-4">
        {isLoading ? (
          <div className="flex justify-center py-8" aria-live="polite" aria-label="جاري التحميل">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16 text-text-secondary flex flex-col items-center gap-3" role="status">
            <PackageSearch className="w-14 h-14 opacity-25" aria-hidden="true" />
            <div>
              <p className="font-semibold text-text-primary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                {hasFilters ? 'لا توجد نتائج مطابقة' : 'لا توجد منتجات بعد'}
              </p>
              <p className="text-sm mt-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                {hasFilters ? 'جرّب تغيير كلمة البحث أو الفئة' : 'أضف منتجاتك من قسم المنتجات'}
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
            {!hasFilters && (
              <button
                onClick={() => navigate('/products')}
                className="mt-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                style={{ fontFamily: 'Tajawal, sans-serif' }}
              >
                اذهب إلى المنتجات
              </button>
            )}
          </div>
        ) : (
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const startIdx  = virtualRow.index * columns;
              const rowProds  = products.slice(startIdx, startIdx + columns);
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0, left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: GAP,
                  }}
                  className="flex gap-[10px]"
                >
                  {rowProds.map(product => (
                    <div key={product.id} style={{ width: `${100 / columns}%` }} className="h-full">
                      <ProductCard
                        product={product}
                        onAdd={() => addItem(product)}
                        categoryColor={catColorMap[product.category]}
                        sizeLevel={sizeLevel}
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

/* ─────────────────────────── helpers ─────────────────────────── */

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/* ─────────────────────────── ProductCard ─────────────────────── */

function ProductCard({
  product, onAdd, categoryColor, sizeLevel = 'full',
}: {
  product: Product;
  onAdd: () => void;
  categoryColor?: string;
  sizeLevel?: SizeLevel;
}) {
  const isOutOfStock = product.track_stock && product.stock_qty <= 0;
  const isLowStock   = product.track_stock && product.stock_qty > 0 && product.stock_qty <= product.min_stock;

  const [imageUrl, setImageUrl]     = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [floatPluses, setFloatPluses] = useState<{ id: number; x: number; y: number }[]>([]);
  const floatId    = useRef(0);
  const lastTapRef = useRef(0);

  useEffect(() => {
    let active = true;
    if (product.image_path) {
      loadProductImage(product.image_path).then(url => { if (active && url) setImageUrl(url); });
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
    if (now - lastTapRef.current < 80) return;
    lastTapRef.current = now;
    onAdd();
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 100);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    triggerAdd();
    const rect = e.currentTarget.getBoundingClientRect();
    const id   = floatId.current++;
    setFloatPluses(p => [...p, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    setTimeout(() => setFloatPluses(p => p.filter(f => f.id !== id)), 600);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerAdd(); }
  };

  const baseClass = cn(
    "bg-surface border border-border rounded-xl flex flex-col select-none relative overflow-hidden text-start w-full",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
    isOutOfStock ? "opacity-60 grayscale cursor-not-allowed" : "cursor-pointer hover:border-accent",
    isAnimating ? "scale-[0.96] transition-transform duration-100" : "transition-all"
  );

  /* ── Stock badges (shared across levels) ── */
  const stockBadge = (
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
  );

  /* ── MINI level (<100px wide) ── */
  if (sizeLevel === 'mini') {
    return (
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        disabled={isOutOfStock}
        aria-label={`إضافة ${product.name}، السعر ${formatMoney(product.sale_price)}${isOutOfStock ? '، نفذت الكمية' : ''}`}
        style={{ touchAction: 'manipulation', userSelect: 'none', height: '100%' }}
        className={baseClass}
      >
        {floatPluses.map(fp => (
          <span key={fp.id} aria-hidden="true"
            className="absolute z-10 text-accent font-bold text-base pointer-events-none animate-float-up"
            style={{ insetInlineStart: fp.x, top: fp.y, fontFamily: 'Inter' }}
          >+1</span>
        ))}
        <div className="flex flex-col items-center justify-between h-full px-1 py-1.5 gap-1">
          <p
            className="line-clamp-1 leading-tight text-text-primary w-full text-center"
            style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '11px', fontWeight: 600 }}
          >
            {product.name}
          </p>
          <div className="flex flex-col items-center gap-0.5">
            {stockBadge}
            <span className="numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 700, color: '#CF694A' }}>
              {formatMoney(product.sale_price)}
            </span>
          </div>
        </div>
      </button>
    );
  }

  /* ── COMPACT level (100–149px wide) ── */
  if (sizeLevel === 'compact') {
    const iconSize = imageUrl ? undefined : 32;
    return (
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        disabled={isOutOfStock}
        aria-label={`إضافة ${product.name}، السعر ${formatMoney(product.sale_price)}${isOutOfStock ? '، نفذت الكمية' : ''}`}
        style={{ touchAction: 'manipulation', userSelect: 'none', height: '100%' }}
        className={baseClass}
      >
        {floatPluses.map(fp => (
          <span key={fp.id} aria-hidden="true"
            className="absolute z-10 text-accent font-bold text-lg pointer-events-none animate-float-up"
            style={{ insetInlineStart: fp.x, top: fp.y, fontFamily: 'Inter' }}
          >+1</span>
        ))}
        {/* Icon area ~52px */}
        <div className="h-[52px] w-full shrink-0 overflow-hidden rounded-t-xl">
          {imageUrl ? (
            <img src={imageUrl} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: color.bg, color: color.text }} aria-hidden="true">
              <IconComponent size={iconSize} opacity={0.85} />
            </div>
          )}
        </div>
        {/* Text */}
        <div className="flex flex-col justify-between flex-1 px-1.5 pt-1 pb-1.5 min-h-0">
          <p
            className="line-clamp-2 leading-tight text-text-primary"
            style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '11px', fontWeight: 600 }}
          >
            {product.name}
          </p>
          <div className="flex items-end justify-between">
            {stockBadge}
            <span className="numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 700, color: '#CF694A' }}>
              {formatMoney(product.sale_price)}
            </span>
          </div>
        </div>
      </button>
    );
  }

  /* ── FULL level (≥150px wide) ── */
  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={isOutOfStock}
      aria-label={`إضافة ${product.name}، السعر ${formatMoney(product.sale_price)}${isOutOfStock ? '، نفذت الكمية' : ''}`}
      style={{ touchAction: 'manipulation', userSelect: 'none', height: '100%' }}
      className={baseClass}
    >
      {floatPluses.map(fp => (
        <span key={fp.id} aria-hidden="true"
          className="absolute z-10 text-accent font-bold text-xl pointer-events-none animate-float-up"
          style={{ left: fp.x, top: fp.y, fontFamily: 'Inter' }}
        >+1</span>
      ))}
      {/* Image / Icon area 88px */}
      <div className="h-[88px] w-full shrink-0 overflow-hidden rounded-t-xl">
        {imageUrl ? (
          <img src={imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: color.bg, color: color.text }} aria-hidden="true">
            <IconComponent size={40} opacity={0.85} />
          </div>
        )}
      </div>
      {/* Text */}
      <div className="flex flex-col justify-between flex-1 px-2 pt-1 pb-2 min-h-0">
        <h3
          className="line-clamp-2 leading-tight text-text-primary"
          style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '13px', fontWeight: 600 }}
        >
          {product.name}
        </h3>
        <div className="flex items-end justify-between">
          {stockBadge}
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
