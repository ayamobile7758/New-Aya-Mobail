# الباقة 6 — الأمان (اختياري، تطبيق منفصل) — BUNDLE 6 README

> ⚠️ **هذه الباقة اختيارية ويجب تطبيقها منفصلاً عن الباقات 1-5.**
>
> الباقات 1-5 تحل مشاكل محاسبية ووظيفية. هذه الباقة تحل أخطر ثغرة أمنية: أي شخص يحمل مفتاح `anon` (الموجود في تطبيق كل جهاز) يستطيع تنفيذ `DROP TABLE invoices` أو `UPDATE accounts SET balance=0`.

---

## ما الذي تُصلحه هذه الباقة

الثغرة: دالتا `exec_sql` و`exec_batch` في `supabase/functions.sql` هما `SECURITY DEFINER` وتقبلان أي نص SQL. مفتاح `anon` مضمَّن في حزمة التطبيق (علني بطبيعة الحال في PWA). لذلك:

1. يستطيع أي شخص يستخرج المفتاح من جهاز واحد تنفيذ أي استعلام SQL.
2. سياسات RLS الحالية مسموحة للجميع (`USING (true) WITH CHECK (true)`) فلا تحمي شيئاً.

---

## ملفات الباقة

| الملف | الوصف |
|---|---|
| `01_exec_sql_readonly.sql` | تقييد `exec_sql` لرفض أي جملة تعديل (INSERT/UPDATE/DELETE/DDL) |
| `02_rls_policies.sql` | استبدال سياسات `anon_all` المسموحة للجميع بسياسات SELECT+INSERT فقط (لا UPDATE/DELETE مباشر) |
| `supabaseAdapter.ts` | (اختياري) الشكل النهائي للمحوّل بعد الترحيل الكامل إلى RPCs مُسمّاة |

---

## ⚠️ يجب نسخ هذا في محرر SQL في Supabase

### الخطوة 1: انسخ `01_exec_sql_readonly.sql`

افتح Supabase Dashboard → SQL Editor → الصق المحتوى → Run.

**النتيجة المتوقعة:** `Success. No rows returned`.

**التحقق:** نفّذ الاختبار التالي في SQL Editor:
```sql
SELECT public.exec_sql('UPDATE accounts SET balance = 0', '[]'::jsonb);
```
يجب أن يُرجع خطأ: `exec_sql is read-only. Mutation statements (INSERT/UPDATE/DELETE/DDL) must use a typed RPC.`

### الخطوة 2: انسخ `02_rls_policies.sql`

في نفس SQL Editor، الصق المحتوى → Run.

**النتيجة المتوقعة:** `Success. No rows returned`.

**التحقق:** نفّذ:
```sql
SELECT tablename, policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'invoice_payments';
```
يجب أن يُظهر سطرين فقط: `anon_select` (SELECT) و`anon_insert` (INSERT). لا سياسات UPDATE أو DELETE.

---

## ⚠️ تحذير: هذا التغيير قد يُكسر استدعاءات قديمة

### ما الذي سيستمر بالعمل

- **`complete_sale` RPC** — مُسمّى ومُحدَّد المعاملات، يعمل كالمعتاد.
- **جميع استدعاءات `dbClient.query(...)`** للاستعلامات (SELECT) — تعمل لأن `exec_sql` لا يزال يقبل SELECT.
- **استدعاءات `dbClient.batchRun([...])`** — تعمل **مؤقتاً** لأن `exec_batch` لا يزال يسمح بالتعديلات (لم نُقيّده بعد).

### ما الذي قد ينكسر

- **استدعاءات `supabase.from('table').update(...)` أو `.delete(...)` المباشرة** — إذا وُجدت في الكود، ستبدأ بإرجاع 403. تحقّق من الكود قبل التطبيق.

### ما الذي يجب عمله لاحقاً (Migration Plan)

للوصول إلى الحالة الآمنة بالكامل، يجب على المهندس:

1. **إنشاء دوال RPC مُسمّاة** في `supabase/functions.sql` لكل تحوير حالياً يستخدم `batchRun`:
   - `return_invoice(p_invoice_id text, p_refunds jsonb)`
   - `create_expense(p_payload jsonb)`
   - `update_expense(p_id text, p_payload jsonb)`
   - `delete_expense(p_id text)`
   - `restore_expense(p_id text)`
   - `create_topup(p_payload jsonb)`
   - `create_transfer(p_payload jsonb)`
   - `close_day(p_target_date text, p_cash_counts jsonb, p_notes text)`
   - `reopen_day(p_date text)`
   - `create_inventory_count(p_items jsonb, p_notes text)`
   - `create_account_reconciliation(p_account_id text, p_actual_balance int)`
   - `update_maintenance_job_status(p_id text, p_status text, p_final_amount int, p_payment_account_id text)`

   كل دالة تأخذ معاملات مُحدَّدة النوع (لا نص SQL خام) وتبني الاستعلام داخلياً مع parameter binding.

2. **إضافة طرق مُقابلة** في `supabaseAdapter.ts` (ملف `supabaseAdapter.ts` المرفق يُظهر الشكل النهائي مع TODOs).

3. **تحديث كل وحدة query** (`sales.ts`, `expenses.ts`, `operations.ts`, `closures.ts`, `inventory.ts`, `maintenance.ts`) لاستدعاء الطريقة المُسمّاة بدلاً من `batchRun([...])`.

4. **تقييد `exec_batch`** تماماً مثل `exec_sql` (رفض أي جملة تعديل). عند هذه النقطة، التطبيق لم يعد يستخدم `exec_batch` للتعديلات، فالحالة آمنة بالكامل.

هذا الترحيل يستغرق 3-5 أيام عمل مهندس. **لا يجب تطبيقه تحت ضغط وقت** — الباقة 6 في شكلها الحالي (الخطوتان 1+2 فقط) تُغلق ثغرة حقن SQL المباشرة عبر `exec_sql`، وتبقى `exec_batch` كثغرة مؤقتة حتى يكتمل الترحيل.

---

## خطوات التطبيق (الموصى بها)

1. **اختبر الباقات 1-5 أولاً** وتأكد أنها تعمل بشكل صحيح.
2. **خذ نسخة احتياطية من Supabase** (Dashboard → Database → Backups → Create backup).
3. **طبّق الخطوة 1** (`01_exec_sql_readonly.sql`). اختبر التطبيق فوراً:
   - بيع فاتورة — يجب أن ينجح (يستخدم `complete_sale` RPC).
   - استرجاع فاتورة — يجب أن ينجح (يستخدم `exec_batch` الذي لا يزال يسمح بالتعديلات).
   - إضافة مصروف — يجب أن ينجح (نفس السبب).
4. **طبّق الخطوة 2** (`02_rls_policies.sql`). اختبر مرة أخرى:
   - كل العمليات السابقة يجب أن تنجح.
   - حاول من المتصفح: `fetch(SUPABASE_URL + '/rest/v1/invoices?id=eq.XXX', {method:'PATCH', headers:{apikey:ANON_KEY}, body: JSON.stringify({paid_amount:0})})` — يجب أن يُرجع 403.
5. **إذا واجهت مشاكل، استرجع**:
   ```sql
   -- استرجاع exec_sql للنسخة الأصلية (يسمح بالتعديلات)
   -- (احتفظ بنسخة من functions.sql الأصلي قبل التطبيق)
   ```

---

## ما الذي سيلاحظه المالك بعد التطبيق

- **لا تغيير مُرئي** للمستخدم العادي. كل العمليات تستمر بالعمل.
- **محاولات DROP TABLE** من خارج التطبيق (مثلاً من سكريبت خبيث يستخرج مفتاح anon) تُرفض بخطأ `insufficient_privilege`.
- **محاولات UPDATE/DELETE مباشرة** على الجداول (بدون RPC) تُرفض بـ 403.
- **البيانات محمية** بشكل أفضل ضد الهجمات الخارجية.

---

## ما الذي لا تُصلحه هذه الباقة

- **`exec_batch` لا يزال يسمح بالتعديلات.** هذا يعني أن من يستخرج مفتاح anon يستطيع تنفيذ `exec_batch([{sql:'DROP TABLE invoices', params:[]}])` ويتم تنفيذه. الحل الكامل يتطلب ترحيل كل batchRun إلى RPCs مُسمّاة (الخطوات 1-4 أعلاه).
- **المفاتيح المُضمَّنة في الأجهزة القديمة:** إذا سُرِق جهاز قديم قبل تطبيق هذه الباقة، مفتاح anon القديم فيه لا يزال صالحاً. الحل: تدوير مفتاح anon في إعدادات Supabase بعد تطبيق الباقة (Dashboard → Settings → API → Recycle anon key) — لكن هذا يتطلب إعادة نشر التطبيق على جميع الأجهزة بالمفتاح الجديد.

---

## التوصية النهائية للمالك

**طبّق هذه الباقة في وقت هادئ** (مثلاً يوم عطلة، بعد إغلاق اليومية). خذ نسخة احتياطية أولاً. إذا واجهت مشاكل، استرجع SQL الأصلي. الفائدة الأمنية تستحق المخاطرة المنخفضة.

للترحيل الكامل إلى RPCs مُسمّاة (لإغلاق ثغرة `exec_batch` أيضاً): كلّف مهندساً بـ 3-5 أيام عمل متفرّغ. هذا ليس عاجلاً إذا طبّقت الخطوتين 1+2 — هما تُغلقان أخطر ثغرة (حقن SQL المباشر عبر `exec_sql`).
