-- =============================================================================
-- اختبار التحقق من إصلاح العمولات (C-2) في Supabase
-- =============================================================================
-- كيفية الاستخدام:
--   1. افتح Supabase → SQL Editor → New query
--   2. انسخ والصق كل اختبار على حدة (أو الكل دفعة واحدة) واضغط Run
--   3. اقرأ النتيجة المتوقعة المكتوبة فوق كل اختبار
--
-- ملاحظة: هذه اختبارات قراءة فقط (SELECT) — لا تعدّل ولا تحذف أي بيانات. آمنة 100%.
-- =============================================================================


-- ── اختبار 1: تأكد أن الدالة complete_sale موجودة ومحدّثة ──────────────────────
-- المتوقع: صف واحد يُرجع، فيه اسم الدالة. هذا يثبت أن الدالة موجودة.
SELECT proname AS function_name
FROM pg_proc
WHERE proname = 'complete_sale';


-- ── اختبار 2: تأكد أن الدالة تقيّد المبلغ الكامل (GROSS) وليس الصافي ────────────
-- هذا أهم اختبار. يبحث داخل نص الدالة عن السطر الصحيح بعد الإصلاح.
-- المتوقع: العمود "uses_gross_balance" يساوي true
--          والعمود "still_uses_net" يساوي false
-- إذا كان uses_gross_balance = true → الإصلاح مطبّق بنجاح ✅
SELECT
  prosrc LIKE '%balance = balance + v_amount%'      AS uses_gross_balance,   -- يجب true
  prosrc LIKE '%balance = balance + v_net_amount%'  AS still_uses_net        -- يجب false
FROM pg_proc
WHERE proname = 'complete_sale';


-- ── اختبار 3: تأكد أن fee_amount يُجبر على الصفر ───────────────────────────────
-- المتوقع: forces_fee_zero = true
SELECT
  prosrc LIKE '%v_fee_amount := 0;%' AS forces_fee_zero   -- يجب true
FROM pg_proc
WHERE proname = 'complete_sale';


-- ── اختبار 4 (اختياري): أرصدة الحسابات الحالية ────────────────────────────────
-- يعرض حساباتك وأرصدتها وعمولاتها. للاطلاع فقط — تساعدك تتابع قبل/بعد بيعة تجريبية.
-- fee_percent مخزّن بالألف (per-mille): 100 = 10%، 250 = 25%، 0 = لا عمولة.
SELECT
  name              AS account_name,
  type              AS account_type,
  balance           AS balance_fils,
  (balance / 100.0) AS balance_jod,
  fee_percent       AS fee_per_mille
FROM accounts
WHERE deleted_at IS NULL
ORDER BY sort_order;


-- =============================================================================
-- كيف تقرأ النتائج:
--   اختبار 1: لازم يطلّع صف فيه "complete_sale" → الدالة موجودة ✅
--   اختبار 2: uses_gross_balance = true  و  still_uses_net = false → الإصلاح صحيح ✅
--   اختبار 3: forces_fee_zero = true → العمولة تُلغى بنجاح ✅
--   اختبار 4: مجرد عرض لحساباتك (لا حكم نجاح/فشل)
--
-- إذا طلعت أي قيمة عكس المتوقع (مثلاً still_uses_net = true) → احكِ للمراجع فوراً.
-- =============================================================================
