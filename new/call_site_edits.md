# الباقة 4 — تعديلات نقطة الاستدعاء لـ C-9 (Clock Guard Call-Site Edits)

**النمط:** Mode C — تعديلات find/replace لكل ملف.

كل تعديل هنا هو سطر واحد (أو سطرين) يستبدل `format(new Date(), 'yyyy-MM-dd')` بـ `await assertClockNotTampered()` ويضيف سطر الاستيراد في أعلى الملف. هذه التعديلات مكمِّلة لـ `clockGuard.ts` الجديد ولا تعمل بدونه.

---

## 1. `src/db/queries/sales.ts`

### 1a. أضف الاستيراد في أعلى الملف

**ابحث عن:**
```ts
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
```

**استبدل بـ:**
```ts
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
import { assertClockNotTampered } from '@/lib/clockGuard';
```

### 1b. في دالة `completeSale` (حوالي السطر 44)

**ابحث عن:**
```ts
  const invoiceId = nanoid();
  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
```

**استبدل بـ:**
```ts
  const invoiceId = nanoid();
  // C-9: clock-tampering guard — replaces bare `format(new Date(), 'yyyy-MM-dd')`.
  const today = await assertClockNotTampered();
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
```

### 1c. في دالة `returnInvoice` (حوالي السطر 303)

**ابحث عن:**
```ts
  const items = await dbClient.query(`SELECT * FROM invoice_items WHERE invoice_id = ?`, [invoiceId]);
  const stmts: { sql: string; params: any[] }[] = [];
  const now = new Date().toISOString();
  const today = format(new Date(), 'yyyy-MM-dd');
  const deviceId = getDeviceId();
```

**استبدل بـ:**
```ts
  const items = await dbClient.query(`SELECT * FROM invoice_items WHERE invoice_id = ?`, [invoiceId]);
  const stmts: { sql: string; params: any[] }[] = [];
  const now = new Date().toISOString();
  // C-9: clock-tampering guard — the reversal ledger entry_date must not land
  // on a rolled-back date.
  const today = await assertClockNotTampered();
  const deviceId = getDeviceId();
```

### 1d. (اختياري — موصى به) في `completeSale`، ألغِ حساب الرسوم (C-2)

الإصلاح الرئيسي لـ C-2 في `supabase/functions.sql` يجبر `fee_amount = 0`. لكن لتنظيف الكود، يُستحسن تعديل `sales.ts:156-159` أيضاً:

**ابحث عن:**
```ts
    // fee_percent is stored per-mille (بالألف) in schema: e.g. 100 = 10%
    // Divide by 10 to convert to standard percent before applyPercent
    const feeAmount = applyPercent(payment.amount, (acct?.feePercent ?? 0) / 10);
    const netAmount = payment.amount - feeAmount;
```

**استبدل بـ:**
```ts
    // C-2: fees are no longer tracked. Send fee_amount=0 and net_amount=amount.
    // The RPC credits the GROSS to the account.
    const feeAmount = 0;
    const netAmount = payment.amount;
```

وكذلك في `returnInvoice` (حوالي السطر 349-351):

**ابحث عن:**
```ts
    // fee_percent is stored per-mille (بالألف): divide by 10 to get standard percent
    const refundFee = applyPercent(refund.amount, (racct?.feePercent ?? 0) / 10);
    const netRefund = refund.amount - refundFee;
```

**استبدل بـ:**
```ts
    // C-2: fees are no longer tracked. Refund the full amount.
    const refundFee = 0;
    const netRefund = refund.amount;
```

---

## 2. `src/db/queries/closures.ts`

> ملاحظة: هذا التعديل يُطبَّق على الملف الجديد الموجود في `bundle1_accounting/closures.ts` (الذي تستبدله في الباقة 1). إذا تُطبِّق الباقة 1 أولاً، فالملف الجديد لا يحتوي على C-9 بعد — أضفه هنا.

### 2a. أضف الاستيراد في أعلى الملف

**ابحث عن:**
```ts
import { getDeviceId } from '@/lib/device';
import { formatMoney } from '@/lib/money';
```

**استبدل بـ:**
```ts
import { getDeviceId } from '@/lib/device';
import { formatMoney } from '@/lib/money';
import { assertClockNotTampered } from '@/lib/clockGuard';
```

### 2b. في دالة `closeDay` (حوالي السطر 125 في الملف الجديد)

**ابحث عن:**
```ts
  const today = format(new Date(), 'yyyy-MM-dd');
  if (targetDate > today) {
    throw new Error('لا يمكن إقفال يوم مستقبلي');
  }
```

**استبدل بـ:**
```ts
  // C-9: clock-tampering guard — replaces bare `format(new Date(), 'yyyy-MM-dd')`.
  const today = await assertClockNotTampered();
  if (targetDate > today) {
    throw new Error('لا يمكن إقفال يوم مستقبلي');
  }
```

---

## 3. `src/db/queries/inventory.ts`

### 3a. أضف الاستيراد في أعلى الملف

**ابحث عن:**
```ts
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
```

**استبدل بـ:**
```ts
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
import { assertClockNotTampered } from '@/lib/clockGuard';
```

### 3b. في دالة `createInventoryCount` (حوالي السطر 9-11)

**ابحث عن:**
```ts
export async function createInventoryCount(items: { product_id: string; system_qty: number; actual_qty: number; reason: string }[], notes?: string) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd HH:mm:ss');
  const entryDate = format(now, 'yyyy-MM-dd');
  if (await isDayClosed(entryDate)) {
    throw new Error(`يوم ${entryDate} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
```

**استبدل بـ:**
```ts
export async function createInventoryCount(items: { product_id: string; system_qty: number; actual_qty: number; reason: string }[], notes?: string) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd HH:mm:ss');
  // C-9: clock-tampering guard — replaces bare `format(now, 'yyyy-MM-dd')`.
  const entryDate = await assertClockNotTampered();
  if (await isDayClosed(entryDate)) {
    throw new Error(`يوم ${entryDate} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
```

### 3c. في دالة `createAccountReconciliation` (حوالي السطر 92-94)

**ابحث عن:**
```ts
export async function createAccountReconciliation(account_id: string, actual_balance: number) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  if (await isDayClosed(dateStr)) {
    throw new Error(`يوم ${dateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
```

**استبدل بـ:**
```ts
export async function createAccountReconciliation(account_id: string, actual_balance: number) {
  const now = new Date();
  // C-9: clock-tampering guard — replaces bare `format(now, 'yyyy-MM-dd')`.
  const dateStr = await assertClockNotTampered();
  if (await isDayClosed(dateStr)) {
    throw new Error(`يوم ${dateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
```

---

## 4. `src/db/queries/expenses.ts`

### 4a. أضف الاستيراد في أعلى الملف

**ابحث عن:**
```ts
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
import { formatMoney } from '@/lib/money';
```

**استبدل بـ:**
```ts
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
import { formatMoney } from '@/lib/money';
import { assertClockNotTampered } from '@/lib/clockGuard';
```

### 4b. في دالة `addExpense` (حوالي السطر 75)

**ابحث عن:**
```ts
  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  // التحقق من كفاية الرصيد قبل الخصم
```

**استبدل بـ:**
```ts
  // C-9: clock-tampering guard — replaces bare `format(new Date(), 'yyyy-MM-dd')`.
  const today = await assertClockNotTampered();
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  // التحقق من كفاية الرصيد قبل الخصم
```

### 4c. في دالة `deleteExpense` (حوالي السطر 176)

**ابحث عن:**
```ts
  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const tx: { sql: string; params: any[] }[] = [];

  // 1. Mark expense as deleted
```

**استبدل بـ:**
```ts
  // C-9: clock-tampering guard — replaces bare `format(new Date(), 'yyyy-MM-dd')`.
  const today = await assertClockNotTampered();
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const tx: { sql: string; params: any[] }[] = [];

  // 1. Mark expense as deleted
```

### 4d. في دالة `restoreExpense` (حوالي السطر 232)

**ابحث عن:**
```ts
  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  // ME-D safety check: verify the account still has
```

**استبدل بـ:**
```ts
  // C-9: clock-tampering guard — replaces bare `format(new Date(), 'yyyy-MM-dd')`.
  const today = await assertClockNotTampered();
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  // ME-D safety check: verify the account still has
```

### 4e. في دالة `updateExpense` (حوالي السطر 320)

**ابحث عن:**
```ts
  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const stmts: { sql: string; params: any[] }[] = [];

  // 1. Update expense record
```

**استبدل بـ:**
```ts
  // C-9: clock-tampering guard — replaces bare `format(new Date(), 'yyyy-MM-dd')`.
  const today = await assertClockNotTampered();
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const stmts: { sql: string; params: any[] }[] = [];

  // 1. Update expense record
```

---

## 5. `src/App.tsx` — بذر الساعة عند الإقلاع (Boot Seed)

### 5a. أضف الاستيراد بعد استيراد `runMigrations`

**ابحث عن:**
```ts
import { initDatabase, isSupabaseMode } from './db/client';
import { runMigrations } from './db/migrations';
import { setupRealtimeSync } from './db/realtime';
```

**استبدل بـ:**
```ts
import { initDatabase, isSupabaseMode } from './db/client';
import { runMigrations } from './db/migrations';
import { setupRealtimeSync } from './db/realtime';
import { assertClockNotTampered } from './lib/clockGuard';
```

### 5b. أضف استدعاء البذر داخل دالة `setup()` (بعد `initDatabase`، قبل `runMigrations`)

**ابحث عن:**
```ts
    async function setup() {
      try {
        await ensurePersistence();
        await initDatabase();
      } catch (err: any) {
        setDbState('error');
        setErrorMsg(err.message || 'Unknown database error');
        return;
      }

      try {
        await runMigrations();
        // Removed old checkPin call here since AuthProvider handles it
        setDbState('ready');
      } catch (err: any) {
        setDbState('migration-error');
        setErrorMsg(err.message || 'Unknown migration error');
      }
    }
```

**استبدل بـ:**
```ts
    async function setup() {
      try {
        await ensurePersistence();
        await initDatabase();
        // C-9: seed last_known_date on boot so the guard works even if the
        // user opens the app but doesn't make a sale. Non-fatal on failure
        // (the guard will still work against the cached value).
        try {
          await assertClockNotTampered();
        } catch (err: any) {
          // If the clock was already rolled back before this boot, surface
          // the error to the user instead of letting the app appear to load.
          setDbState('error');
          setErrorMsg(err.message || 'Clock tampering detected');
          return;
        }
      } catch (err: any) {
        setDbState('error');
        setErrorMsg(err.message || 'Unknown database error');
        return;
      }

      try {
        await runMigrations();
        // Removed old checkPin call here since AuthProvider handles it
        setDbState('ready');
      } catch (err: any) {
        setDbState('migration-error');
        setErrorMsg(err.message || 'Unknown migration error');
      }
    }
```

---

## ملاحظات للمهندس

- **ترتيب التطبيق:** طبّق `clockGuard.ts` (الملف الجديد) أولاً، ثم عدّلات الاستدعاء في الملفات الخمسة. بدون `clockGuard.ts`، الـ imports ستفشل.
- **اختبار أول تشغيل:** بعد التطبيق، احذف `IndexedDB` للموقع في المتصفح (DevTools → Application → IndexedDB → حذف قاعدة البيانات) لمحاكاة أول تشغيل. يجب ألا يظهر خطأ — الساعة تُبذر تلقائياً.
- **اختبار تقديم الساعة:** غيّر ساعة الجهاز لليوم التالي ثم أعد التحميل. يجب أن يعمل التطبيق (لا خطأ). غيّرها لليوم السابق ثم حاول بيعاً — يجب أن يظهر الخطأ العربي المذكور في `clockGuard.ts`.
- **لا SQL مطلوب:** كل التعديلات هنا في كود TypeScript فقط.
