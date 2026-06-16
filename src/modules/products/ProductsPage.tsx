import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllProducts, Product } from '@/db/queries/products';
import { getCategories } from '@/db/queries/categories';
import { Plus, Search, AlertTriangle, CheckCircle, XCircle, Package } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ProductEditor } from './components/ProductEditor';

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | string>('all');
  const [showInactive, setShowInactive] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const { data: dbCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(false),
    staleTime: Infinity,
  });

  const CATEGORIES = [
    { id: 'all', name: 'الكل' },
    ...dbCategories.map(c => ({ id: c.id, name: c.name })),
  ];

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', search, category, showInactive],
    queryFn: () => getAllProducts(search, category, showInactive),
  });

  const handleEdit = (product: Product) => {
    setSelectedProduct(product);
    setEditorOpen(true);
  };

  const handleCreate = () => {
    setSelectedProduct(null);
    setEditorOpen(true);
  };

  return (
    <div className="flex flex-col h-full bg-background relative isolate">
      {/* Header */}
      <header className="bg-surface border-b border-border p-4 sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex justify-between items-start md:items-center">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold">إدارة الأصناف والمستودع</h1>
                <p className="text-sm text-text-secondary">إدارة المنتجات، الأصناف، والأسعار</p>
              </div>
            </div>
            <button 
              onClick={handleCreate}
              className="bg-accent text-white px-4 h-10 rounded-lg font-medium flex items-center gap-2 hover:bg-accent-hover transition-colors shadow-sm shrink-0"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden sm:inline">إضافة صنف</span>
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute end-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input 
                type="text" 
                placeholder="بحث بالاسم أو الكود (SKU)..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-11 ps-4 pe-10 rounded-xl border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              />
            </div>
            <div className="flex gap-2 pb-2 md:pb-0 overflow-x-auto hide-scrollbar">
              {CATEGORIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    "px-4 h-11 rounded-xl whitespace-nowrap font-medium transition-colors cursor-pointer border shadow-sm shrink-0",
                    category === c.id 
                      ? "bg-text-primary text-white border-transparent" 
                      : "bg-surface border-border text-text-secondary hover:border-accent"
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 px-4 h-11 rounded-xl border border-border bg-surface shrink-0 cursor-pointer">
              <input 
                type="checkbox" 
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="accent-accent flex-shrink-0"
              />
              <span className="text-sm font-medium">عرض المتوقفة</span>
            </label>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto">
          {isLoading ? (
            <div className="flex justify-center p-12">
              <div className="animate-spin w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full"></div>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center p-12 bg-surface rounded-2xl border border-border">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-text-secondary" />
              </div>
              <h3 className="text-lg font-bold mb-2">لا توجد أصناف</h3>
              <p className="text-secondary">لم يتم العثور على أي بيانات مطابقة لبحثك.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {products.map(product => {
                const categoryName = CATEGORIES.find(c => c.id === product.category)?.name || product.category;
                const isLowStock = product.track_stock && product.stock_qty <= product.min_stock;
                
                return (
                  <div 
                    key={product.id} 
                    onClick={() => handleEdit(product)}
                    className={cn(
                      "bg-surface border border-border rounded-2xl p-4 cursor-pointer hover:shadow-md transition-shadow relative overflow-hidden group",
                      !product.is_active && "opacity-60 grayscale-[50%]"
                    )}
                  >
                    {!product.is_active && (
                       <div className="absolute top-2 start-2 bg-danger/10 text-danger text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                         <XCircle className="w-3 h-3" /> متوقف
                       </div>
                    )}
                    {product.is_quick_add && product.is_active && (
                       <div className="absolute top-2 start-2 bg-success/10 text-success text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                         <CheckCircle className="w-3 h-3" /> سريع
                       </div>
                    )}

                    <div className="text-xs text-text-secondary mb-1">{categoryName}</div>
                    <h3 className="font-bold text-lg leading-tight mb-1 pe-14">{product.name}</h3>
                    {product.sku && <div className="text-xs text-text-secondary font-mono bg-muted inline-block px-1.5 rounded mb-3">{product.sku}</div>}
                    
                    <div className="flex justify-between items-end mt-4">
                      <div className="font-bold text-lg numeric text-accent">{formatMoney(product.sale_price)}</div>
                      
                      {product.track_stock ? (
                        <div className={cn(
                          "text-sm font-bold flex items-center gap-1 px-2 py-1 rounded-lg",
                          isLowStock ? "bg-danger-bg text-danger" : "bg-muted text-text-primary"
                        )}>
                          {isLowStock && <AlertTriangle className="w-4 h-4" />}
                          مخزون: <span className="numeric">{product.stock_qty}</span>
                        </div>
                      ) : (
                        <div className="text-xs text-text-secondary bg-muted px-2 py-1 rounded-lg">بدون تتبع</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <ProductEditor 
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        product={selectedProduct}
      />
    </div>
  );
}
