# الباقة 5 — التنظيف للوضع السحابي فقط (BUNDLE 5 NOTES)

## الملفات

| الملف | النمط | الوصف |
|---|---|---|
| `client.ts` | A (كامل) | حذف كود SQLite/Comlink المعطّل، تبسيط `isSupabaseMode` |
| `README.md` | A (كامل) | تحديث شامل ليوضّح أن النظام سحابي فقط |
| `DailyLockScreen.tsx` | A (كامل) | إضافة لافتة "غير متصل" حمراء عند انقطاع الإنترنت |
| `vite_config_change.md` | C | تعديل سطر واحد: وصف PWA |
| `package_json_changes.md` | C | حذف حزمتي `@sqlite.org/sqlite-wasm` و`comlink` |

---

## إصلاح A-1 — الالتزام بالوضع السحابي فقط

**قرار المالك:** لا وضع offline. النظام سحابي فقط (Supabase). أي انقطاع إنترنت يُظهر خطأً عربياً واضحاً ويُحافظ على السلة. لا طابور مبيعات معلّقة.

**ما يتغيّر:**
1. **`src/db/client.ts`** — حذف التعليقات القديمة في الأعلى، تبسيط الملف إلى 3 أسطر فعلية. `isSupabaseMode()` تُرجع `true` دائماً.
2. **`README.md`** — إعادة كتابة كاملة توضّح المتطلبات (Supabase + إنترنت دائم).
3. **`src/components/auth/DailyLockScreen.tsx`** — إضافة تتبّع `navigator.onLine` وعرض لافتة حمراء عند الانقطاع.
4. **`vite.config.ts`** — تحديث وصف PWA من "يعمل بدون إنترنت" إلى "يتطلب اتصالاً بالإنترنت".
5. **`package.json`** — حذف `@sqlite.org/sqlite-wasm` و`comlink` لتصغير الحزمة.
6. **`src/db/worker.ts`** — (للمهندس) انقل الملف إلى `src/db/_archived/worker.ts.sqlite-mode.txt` بدلاً من حذفه (للمرجعية التاريخية).

---

## إصلاح A-3 — تأكيد سلوك الفشل عند انقطاع الإنترنت (لا طابور)

قرار المالك: **لا طابور offline**. السلوك الحالي عند انقطاع الإنترنت أثناء البيع:

1. `supabaseAdapter.completeSaleRpc` يستدعي `supabase.rpc('complete_sale', ...)`.
2. عند فشل الشبكة، يُرمى `TypeError: Failed to fetch`.
3. `checkoutMutation.onError` في `PaymentDialog.tsx` يُظهر toast: `"حدث خطأ أثناء حفظ الفاتورة: TypeError: Failed to fetch"`.
4. السلة تُحفظ في Zustand state (في الذاكرة) وlocalStorage (إذا لم تمتلئ المساحة).
5. الكاشير يرى الخطأ ويُعيد المحاولة عند عودة الاتصال — السلة لا تضيع.

**تحسين صغير موصى به (اختياري):** رسالة الخطأ الحالية تقول `"TypeError: Failed to fetch"` وهي إنجليزية ومُربكة للمستخدم العربي. يُستحسن تعديل `PaymentDialog.tsx:110-112` ليُظهر رسالة عربية أوضح:

```ts
// القديم:
onError: (err: any) => {
  toast.error('حدث خطأ أثناء حفظ الفاتورة: ' + err.message);
}

// الجديد (موصى به):
onError: (err: any) => {
  const isNetworkError =
    err.message?.includes('Failed to fetch') ||
    err.message?.includes('NetworkError') ||
    err.message?.includes('network');
  if (isNetworkError) {
    toast.error('تعذّر الاتصال بالخادم — تحقّق من الإنترنت ثم أعد المحاولة. السلة محفوظة.');
  } else {
    toast.error('حدث خطأ أثناء حفظ الفاتورة: ' + err.message);
  }
}
```

هذا التحسين اختياري — السلوك الأساسي (الحفاظ على السلة + إظهار خطأ) موجود بالفعل.

---

## خطوات التطبيق

1. انسخ `client.ts` إلى `src/db/client.ts` (يستبدل الموجود).
2. انسخ `README.md` إلى جذر المستودع (يستبدل الموجود).
3. انسخ `DailyLockScreen.tsx` إلى `src/components/auth/DailyLockScreen.tsx` (يستبدل الموجود).
4. افتح `vite_config_change.md` وطبّق تعديل السطر الواحد.
5. افتح `package_json_changes.md` وطبّق حذف الحزمتين.
6. (للمهندس) انقل `src/db/worker.ts` إلى `src/db/_archived/worker.ts.sqlite-mode.txt`.
7. شغّل `npm install` ثم `npm run build` للتأكد من النجاح.
8. اختبر السيناريوهات في قائمة التحقق.

---

## ما الذي سيلاحظه المالك بعد التطبيق

- **لافتة حمراء** على شاشة الدخول عند انقطاع الإنترنت: "التطبيق غير متصل بالإنترنت — لا يمكن تسجيل المبيعات حتى يستعيد الاتصال."
- **README جديد** يوضّح المتطلبات (Supabase + إنترنت).
- **وصف PWA** في المتصفح يقول "يتطلب اتصالاً بالإنترنت".
- **حجم التطبيق** أصغر بحوالي 1.5 ميجابايت (بعد حذف حزم SQLite-WASM).
- **رسالة خطأ أوضح** عند الفشل في البيع (إذا طُبّق التحسين الاختياري): "تعذّر الاتصال بالخادم — تحقّق من الإنترنت ثم أعد المحاولة. السلة محفوظة."
