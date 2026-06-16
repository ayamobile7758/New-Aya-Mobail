# الباقة 5 — تعديل `vite.config.ts` (BUNDLE 5 — Mode C)

**المشكلة:** وصف PWA في `vite.config.ts` يقول "نظام نقطة بيع متكامل يعمل بدون إنترنت" وهذا لم يعد صحيحاً بعد الالتزام بالوضع السحابي فقط.

## التعديل

افتح `vite.config.ts` وابحث عن كتلة `manifest` داخل `VitePWA({...})` (حوالي السطر 13-36).

**ابحث عن:**
```ts
        manifest: {
          name: 'نظام إدارة المتاجر',
          short_name: 'نقطة البيع',
          description: 'نظام نقطة بيع متكامل يعمل بدون إنترنت',
          theme_color: '#F9F8F5',
          background_color: '#F9F8F5',
          display: 'standalone',
          orientation: 'any',
```

**استبدل بـ:**
```ts
        manifest: {
          name: 'نظام إدارة المتاجر',
          short_name: 'نقطة البيع',
          // A-1: cloud-only — updated description to reflect that internet is required.
          description: 'نظام نقطة بيع متكامل — يتطلب اتصالاً بالإنترنت',
          theme_color: '#F9F8F5',
          background_color: '#F9F8F5',
          display: 'standalone',
          orientation: 'any',
```

## ملاحظات

- هذا التعديل وحده لا يكفي — يجب أيضاً تطبيق بقية ملفات الباقة 5 (`client.ts`, `README.md`, `DailyLockScreen.tsx`).
- بعد التعديل، أعد تشغيل `npm run dev` ليُعاد توليد manifest.
- للتحقق: افتح DevTools → Application → Manifest — يجب أن يظهر الوصف الجديد.
