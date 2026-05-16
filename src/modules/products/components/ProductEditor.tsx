import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Product, addProduct, updateProduct, toggleProductActive } from '@/db/queries/products';
import { getCategories } from '@/db/queries/categories';
import { X, Save, Power } from 'lucide-react';
import { parseMoney } from '@/lib/money';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { IconPicker } from '@/components/products/IconPicker';
import { ImageUploader } from '@/components/products/ImageUploader';
import { saveProductImage, loadProductImage, deleteProductImage } from '@/lib/imageStorage';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface ProductEditorProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ProductEditor({ product, isOpen, onClose }: ProductEditorProps) {
  const queryClient = useQueryClient();
  const isEditing = !!product;
  const { requireAdminAction } = useAuth();
  const [confirmToggle, setConfirmToggle] = useState(false);

  const { data: dbCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(true),
    staleTime: Infinity,
  });

  const CATEGORIES = dbCategories.map(c => ({ id: c.id, name: c.name }));

  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    category: 'device',
    sale_price: '',
    cost_price: '',
    stock_qty: '0',
    min_stock: '0',
    track_stock: false,
    is_quick_add: false,
    notes: ''
  });
  
  const [icon, setIcon] = useState('Box');
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageChanged, setImageChanged] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (product) {
        setFormData({
          name: product.name,
          sku: product.sku || '',
          category: product.category,
          sale_price: (product.sale_price / 100).toString(),
          cost_price: product.cost_price > 0 ? (product.cost_price / 100).toString() : '',
          stock_qty: product.stock_qty.toString(),
          min_stock: product.min_stock.toString(),
          track_stock: product.track_stock,
          is_quick_add: product.is_quick_add,
          notes: product.notes || ''
        });
        setIcon(product.icon || 'Box');
        if (product.image_path) {
          loadProductImage(product.image_path).then(setPreviewUrl);
        } else {
          setPreviewUrl(null);
        }
        setImageBlob(null);
        setImageChanged(false);
      } else {
        setFormData({
          name: '',
          sku: '',
          category: 'device',
          sale_price: '',
          cost_price: '',
          stock_qty: '0',
          min_stock: '0',
          track_stock: true,
          is_quick_add: false,
          notes: ''
        });
        setIcon('Box');
        setPreviewUrl(null);
        setImageBlob(null);
        setImageChanged(false);
      }
    }
  }, [isOpen, product]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const dataToSave = {
        name: formData.name,
        sku: formData.sku || null,
        category: formData.category as any,
        sale_price: parseMoney(formData.sale_price),
        cost_price: formData.cost_price ? parseMoney(formData.cost_price) : 0,
        stock_qty: parseInt(formData.stock_qty) || 0,
        min_stock: parseInt(formData.min_stock) || 0,
        track_stock: formData.track_stock,
        is_quick_add: formData.is_quick_add,
        notes: formData.notes || null,
        icon: icon,
      };

      let savedId = '';
      if (isEditing && product) {
        await updateProduct(product.id, dataToSave);
        savedId = product.id;
      } else {
        savedId = await addProduct(dataToSave);
      }

      if (imageChanged && imageBlob) {
        const path = await saveProductImage(savedId, imageBlob);
        await updateProduct(savedId, { image_path: path });
      } else if (imageChanged && !imageBlob && isEditing && product?.image_path) {
        await deleteProductImage(savedId);
        await updateProduct(savedId, { image_path: null });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(isEditing ? 'تم تحديث المنتج بنجاح' : 'تم إضافة المنتج بنجاح');
      onClose();
    },
    onError: (error: any) => {
      toast.error('حدث خطأ: ' + error.message);
    }
  });

  const toggleMutation = useMutation({
    mutationFn: async () => {
      if (!product) return;
      await toggleProductActive(product.id, !product.is_active);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(product?.is_active ? 'تم إيقاف المنتج' : 'تم تفعيل المنتج');
      onClose();
    }
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md bg-surface h-full shadow-2xl flex flex-col animate-in slide-in-from-right sm:border-l border-border">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-background">
          <h2 className="text-xl font-bold flex items-center gap-2">
            {isEditing ? 'تعديل الصنف' : 'إضافة صنف جديد'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full">
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">اسم الصنف <span className="text-danger">*</span></label>
            <input 
              type="text" 
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              required
              className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              placeholder="مثال: شاشة ايفون 13 برو"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">رمز الباركود (SKU)</label>
              <input 
                type="text" 
                value={formData.sku}
                onChange={(e) => setFormData({...formData, sku: e.target.value})}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                placeholder="اختياري"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">التصنيف</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none"
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">الرمز (أيقونة المنتج)</label>
            <IconPicker category={formData.category} selectedIcon={icon} onChange={setIcon} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">صورة المنتج</label>
            <ImageUploader 
              initialImageBlobUrl={previewUrl || undefined}
              onImageChange={(blob) => {
                setImageBlob(blob);
                setImageChanged(true);
                if (!blob) setPreviewUrl(null);
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">سعر البيع <span className="text-danger">*</span></label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.sale_price}
                  onChange={(e) => setFormData({...formData, sale_price: e.target.value})}
                  required
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none font-bold numeric text-lg ps-12"
                />
                <span className="absolute start-4 top-1/2 -translate-y-1/2 text-text-secondary text-sm">د.أ</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">سعر التكلفة <span className="text-text-secondary text-xs">(اختياري)</span></label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.cost_price}
                  onChange={(e) => setFormData({...formData, cost_price: e.target.value})}
                  placeholder="0"
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none font-bold numeric text-lg ps-12"
                />
                <span className="absolute start-4 top-1/2 -translate-y-1/2 text-text-secondary text-sm">د.أ</span>
              </div>
            </div>
          </div>

          <div className="border border-border rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">تتبع المخزون</h4>
                <p className="text-secondary text-xs">هل يجب حساب كمية هذا الصنف وتنبيهك؟</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={formData.track_stock}
                  onChange={(e) => setFormData({...formData, track_stock: e.target.checked})}
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:end-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
              </label>
            </div>

            {formData.track_stock && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-sm font-medium mb-2">الكمية الحالية</label>
                  <input 
                    type="number" 
                    value={formData.stock_qty}
                    onChange={(e) => setFormData({...formData, stock_qty: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">حد النواقص</label>
                  <input 
                    type="number" 
                    value={formData.min_stock}
                    onChange={(e) => setFormData({...formData, min_stock: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border border-border rounded-xl p-4">
            <div>
              <h4 className="font-medium">إضافة سريعة في نقطة البيع</h4>
              <p className="text-text-secondary text-xs">إظهار كزر سريع في شاشة نقطة البيع</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={formData.is_quick_add}
                onChange={(e) => setFormData({...formData, is_quick_add: e.target.checked})}
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:end-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
            </label>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">ملاحظات (اختياري)</label>
            <textarea 
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:border-accent focus:ring-1 focus:ring-accent outline-none h-24 resize-none"
            />
          </div>

        </div>

        <div className="p-4 border-t border-border bg-background flex gap-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => {
              if (isEditing) {
                requireAdminAction(() => saveMutation.mutate());
              } else {
                saveMutation.mutate();
              }
            }}
            disabled={saveMutation.isPending || !formData.name || !formData.sale_price}
            className="flex-1 h-[var(--btn-height)] bg-accent text-white font-bold rounded-lg disabled:opacity-50 hover:bg-accent-hover transition-colors flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            حفظ البيانات
          </button>
          
          {isEditing && (
             <button
              onClick={() => setConfirmToggle(true)}
              className="px-4 h-[var(--btn-height)] bg-surface border border-border text-text-primary rounded-lg hover:bg-muted transition-colors flex justify-center items-center"
              title={product.is_active ? "إيقاف الصنف" : "تفعيل الصنف"}
            >
               <Power className={`w-5 h-5 ${product.is_active ? 'text-danger' : 'text-success'}`} />
             </button>
          )}
        </div>
      </div>

      {isEditing && (
        <ConfirmDialog
          open={confirmToggle}
          title={product.is_active ? 'إيقاف الصنف' : 'تفعيل الصنف'}
          message={`هل أنت متأكد من ${product.is_active ? 'إيقاف' : 'تفعيل'} هذا الصنف؟`}
          confirmLabel={product.is_active ? 'إيقاف' : 'تفعيل'}
          cancelLabel="إلغاء"
          danger={product.is_active}
          onConfirm={() => { requireAdminAction(() => toggleMutation.mutate()); setConfirmToggle(false); }}
          onCancel={() => setConfirmToggle(false)}
        />
      )}
    </div>
  );
}
