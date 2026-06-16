# الباقة 2 — إلغاء تتبع رسوم الدفع (BUNDLE 2 NOTES)

**القرار النهائي للمالك:** لا تتبع الرسوم إطلاقاً. يُضاف المبلغ الكامل (Gross) للحساب، ويُسجَّل في الدفاتر بالمبلغ الكامل. حقل `fee_amount` يُخزَّن كـ 0 دائماً.

---

## ماذا تغيّر في `supabase/functions.sql`

استبدل دالة `complete_sale` الحالية بدالة الملف `complete_sale_rpc.sql` المرفق. الفروقات الجوهرية:

| السطر القديم | السطر الجديد | السبب |
|---|---|---|
| `UPDATE accounts SET balance = balance + v_net_amount` | `UPDATE accounts SET balance = balance + v_amount` | إضافة المبلغ الكامل (Gross) بدل المبلغ بعد الرسوم |
| `INSERT INTO ledger_entries ... 'credit', v_net_amount, ...` | `INSERT INTO ledger_entries ... 'credit', v_amount, ...` | تسجيل المبلغ الكامل في الدفاتر |
| `INSERT INTO invoice_payments (..., fee_amount, ...) VALUES (..., v_fee_amount, ...)` | `INSERT INTO invoice_payments (..., fee_amount, ...) VALUES (..., 0, ...)` | فرض `fee_amount = 0` حتى لو أرسل العميل قيمة غير صفرية |

المتغيّر `v_net_amount` ما زال موجوداً في الدالة للوضوح فقط، لكنه يُساوي `v_amount` دائماً.

---

## ماذا يحتاج المهندس لتعديله في كود TypeScript

الملف `src/db/queries/sales.ts` لا يحتاج لتعديل إلزامي — فهو يُرسل `fee_amount` و`net_amount` في الـ payload لكن الدالة الجديدة تتجاهلهما. لكن لتقليل الالتباس، يُستحسن تعديل سطر حساب الرسوم في `sales.ts:150-170` ليُرسل `fee_amount: 0` و`net_amount: payment.amount` دائماً:

```ts
// القديم (سطر 156-159):
// fee_percent is stored per-mille (بالألف) in schema: e.g. 100 = 10%
// Divide by 10 to convert to standard percent before applyPercent
const feeAmount = applyPercent(payment.amount, (acct?.feePercent ?? 0) / 10);
const netAmount = payment.amount - feeAmount;

// الجديد:
// C-2: fees are not tracked. Always send 0 to the RPC; the RPC credits the gross.
const feeAmount = 0;
const netAmount = payment.amount;
```

كذلك في `sales.ts:349-351` (دالة `returnInvoice`):

```ts
// القديم:
const refundFee = applyPercent(refund.amount, (racct?.feePercent ?? 0) / 10);
const netRefund = refund.amount - refundFee;

// الجديد:
const refundFee = 0;
const netRefund = refund.amount;
```

هذا التعديل في TypeScript **اختياري** — الدالة الجديدة في Supabase ستعمل بشكل صحيح حتى لو أرسل الكود القديم قيمة `fee_amount` غير صفرية (ستُجبر على 0). لكن التعديل يُبقي الكود متسقاً مع المنطق.

---

## توافق الأسطح الثلاثة (Three-Surface Consistency)

بعد تطبيق هذه الباقة:

| السطح | كيف يتعامل مع الرسوم |
|---|---|
| `getReport` (Overview) | لا يقرأ `fee_amount` إطلاقاً. `byAccount` يجمع `ip.amount` (Gross) = رصيد الحساب ✓ |
| `getProfitAndLoss` (P&L) | لا يخصم أي رسوم. الصيغة: `net_profit = gross_profit + topup + maintenance - expenses` |
| `getOpenDayPreview` (Day Closure) | لا يخصم أي رسوم. نفس صيغة P&L لكن ليوم واحد |

الأسطح الثلاثة متوافقة **بنيوياً** بعد هذا التغيير — لا يوجد أي مسار يخصم رسوماً.

---

## ما الذي يحدث للبيانات التاريخية؟

- صفوف `invoice_payments` القديمة (التي سُجِّلت قبل التطبيق) تحتفظ بقيم `fee_amount` القديمة (قد تكون غير صفرية). هذه القيم لا تُقرأ في أي صيغة حسابية الآن، فهي معلوماتية فقط.
- أرصدة الحسابات القديمة لا تُعدَّل بأثر رجعي — كانت تُحسب بالطريقة القديمة (خصم الرسوم) عند البيع. البيانات التاريخية تظل كما هي.
- المبيعات الجديدة فقط (بعد التطبيق) ستُضيف المبلغ الكامل للحساب.

إذا أراد المالك إعادة تسوية الأرصدة التاريخية، يمكنه تشغيل SQL يدوي:
```sql
-- (اختياري) إضافة الرسوم التاريخية المخصومة إلى أرصدة الحسابات
-- تحذير: نفّذ هذا فقط بعد التحقق من أن الرصيد الحالي فعلاً ناقصاً بالرسوم القديمة.
UPDATE accounts a SET balance = a.balance + COALESCE((
  SELECT SUM(ip.fee_amount) FROM invoice_payments ip
  WHERE ip.account_id = a.id AND ip.fee_amount > 0
), 0)
WHERE EXISTS (
  SELECT 1 FROM invoice_payments ip
  WHERE ip.account_id = a.id AND ip.fee_amount > 0
);
```
**لا نوصي بهذه الخطوة** — اترك التاريخ كما هو وابدأ الصحيح من اليوم.

---

## خطوات التطبيق (Application Steps)

1. افتح Supabase Dashboard → SQL Editor.
2. الصق محتوى `complete_sale_rpc.sql` كاملاً.
3. اضغط **Run**.
4. تحقّق من نجاح التشغيل برسالة `Success. No rows returned` أو ما شابه.
5. (اختياري للمهندس) عدّل `sales.ts` كما هو موضَّح أعلاه لتطابق المنطق.
6. اختبر: بِع 20 د.أ على بطاقة بـ `fee_percent = 250`. تحقّق أن رصيد البطاقة زاد 20.00 د.أ (وليس 15.00).
