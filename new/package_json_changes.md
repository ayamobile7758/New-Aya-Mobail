# الباقة 5 — حذف حزم من `package.json` (BUNDLE 5 — Mode C)

**السبب:** بعد الالتزام بالوضع السحابي فقط، حزمتا `@sqlite.org/sqlite-wasm` و`comlink` لم تعدا مستخدمتين. حذفهما يصغّر حجم التطبيق بحوالي 1.5 ميجابايت.

## التعديل

افتح `package.json` واحذف السطرين التاليين من قسم `dependencies`:

**ابحث عن (حوالي السطر 22-23):**
```json
    "@sqlite.org/sqlite-wasm": "^3.53.0-build1",
```

وفي نفس القسم:

```json
    "comlink": "^4.4.2",
```

**احذفهما.**

ثم شغّل:
```bash
npm install
```

لتحديث `package-lock.json` وإزالة الحزم من `node_modules`.

## ملاحظات

- **لا تحذف** الحزم الأخرى — كل ما تبقّى مُستخدَم.
- بعد الحذف، شغّل `npm run build` للتأكد من عدم وجود استيرادات متعلقة بـ SQLite-WASM أو Comlink. إذا وُجدت، ابحث عن `// import * as Comlink` في `src/db/client.ts` — يجب أن تكون قد حُذفت في الملف الجديد من هذه الباقة.
- **لا تحذف ملف `src/db/worker.ts` فوراً** — بدلاً من ذلك، انقله إلى `src/db/_archived/worker.ts.sqlite-mode.txt` (إعادة تسمية الامتداد يمنع TypeScript من تجميعه). هذا يحتفظ بالكود للمرجعية التاريخية دون كسر البناء.

## التحقق

```bash
# يجب أن ينجح البناء
npm run build

# يجب أن ينجح فحص الأنواع
npm run typecheck

# حجم الحزمة يجب أن يكون أصغر بحوالي 1.5 ميجابايت
ls -lh dist/assets/*.js
```
