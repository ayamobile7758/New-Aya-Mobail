import { AlertOctagon, Download, RefreshCw } from 'lucide-react';
import { performBackup } from '@/lib/backup';
import { isSupabaseMode } from '@/db/client';
import { useState } from 'react';

export function MigrationErrorScreen({ error }: { error: string }) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      await performBackup();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#F9F8F5]">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-6 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
          <AlertOctagon className="w-8 h-8 text-red-600" />
        </div>
        
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          فشل تحديث قاعدة البيانات
        </h1>
        
        <p className="text-gray-600 mb-6">
          حدث خطأ أثناء ترقية قاعدة البيانات. خذ نسخة احتياطية من بياناتك قبل المتابعة.
        </p>
        
        <div className="w-full bg-gray-100 p-4 rounded-xl text-start shrink-0 max-h-40 overflow-y-auto font-mono text-sm text-gray-700 overflow-x-auto mb-8 whitespace-pre-wrap" dir="ltr">
          {error}
        </div>
        
        <div className="flex flex-col gap-3 w-full">
          {isSupabaseMode() ? (
            <p className="text-sm text-gray-600 text-center py-3">
              بياناتك محفوظة بأمان على الخادم السحابي. أعد تحميل الصفحة للمحاولة مجدداً.
            </p>
          ) : (
            <button 
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center justify-center gap-2 w-full bg-[#CF694A] text-white font-bold py-3 rounded-xl transition-colors hover:bg-[#CF694A]/90 disabled:opacity-50"
            >
              <Download className="w-5 h-5" />
              {exporting ? 'جاري التصدير...' : 'تصدير نسخة احتياطية'}
            </button>
          )}
          
          <button 
            onClick={() => window.location.reload()}
            className="flex items-center justify-center gap-2 w-full bg-gray-100 text-gray-800 font-bold py-3 rounded-xl transition-colors hover:bg-gray-200"
          >
            <RefreshCw className="w-5 h-5" />
            إعادة المحاولة
          </button>
        </div>
      </div>
    </div>
  );
}
