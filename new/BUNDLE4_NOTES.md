# الباقة 4 — الصيانة والسجل والساعة (BUNDLE 4 NOTES)

## الملفات

| الملف | النمط | الوصف |
|---|---|---|
| `maintenance.ts` | A (كامل) | إصلاح C-7: عكس تسليم الصيانة عند الإلغاء + استدعاء `assertClockNotTampered` |
| `operations.ts` | A (كامل) | إصلاح C-8: LEFT JOIN لرؤية تعديلات الجرد + استدعاء `assertClockNotTampered` في topup/transfer |
| `clockGuard.ts` | B (جديد) | ملف جديد لـ C-9: حارس الساعة |
| `call_site_edits.md` | C | تعديلات find/replace في 5 ملفات: `sales.ts`، `closures.ts`، `inventory.ts`، `expenses.ts`، `App.tsx` |

---

## إصلاح C-7 — عكس تسليم الصيانة عند الإلغاء

**المشكلة:** إذا سُلِّمت مهمة صيانة (دُفع المبلغ للحساب وكُتب سجل credit)، ثم ضغط المدير "إلغاء"، كان النظام يغيّر الحالة فقط دون عكس المبلغ. النتيجة: الحساب يبقى زائداً بالمبلغ، والسجل يبقى فيه الـ credit، لكن تقرير P&L يستبعد المهمة (status != 'delivered'). الدفاتر تختل.

**الإصلاح:** تقسيم `updateJobStatus` إلى ثلاثة فروع:
1. **الفرع 1 — تسليم** (status === 'delivered'): كما كان، يضيف المبلغ للحساب ويكتب credit.
2. **الفرع 2 — عكس التسليم** (prev.status === 'delivered' && status !== 'delivered'): جديد. يخصم المبلغ من الحساب (عكس الـ credit)، يكتب debit مع ref_type='maintenance'، يمسح `delivered_at` و`final_amount` و`payment_account_id`.
3. **الفرع 3 — تغيير عادي** (كلاهما غير 'delivered'): كما كان، تحديث الحالة فقط.

الحارس المزدوج (منع التسليم المزدوج) لا يزال يعمل في الفرع 1. بعد إلغاء تسليم، يمكن إعادة التسليم لاحقاً لأن `prev.status` لم يعد 'delivered'.

**ملاحظة لواجهة المستخدم:** زر "إلغاء" في `MaintenancePage.tsx` يظهر لكل الحالات بما فيها 'delivered'. مع هذا الإصلاح، الضغط عليه لمهمة مُسلَّمة سيasticعكس المبلغ فوراً. يُستحسن إضافة dialog تأكيد قبل التنفيذ — لكن هذا تحسين UI منفصل وغير مطلوب لإصلاح الدفاتر.

---

## إصلاح C-8 — تعديلات الجرد تظهر في السجل الأخير

**المشكلة:** `getRecentLedgerEntries` كان يستخدم INNER JOIN مع `accounts`. تعديلات الجرد تُكتب بـ `account_id = NULL` (لأنها لا تربط بحساب)، فتختفي من السجل الأخير. لكن `getLedgerForPeriod` يستخدم LEFT JOIN فتظهر هناك — تناقض.

**الإصلاح:**
1. تغيير JOIN إلى LEFT في `getRecentLedgerEntries`.
2. إضافة طبقة TS تعيّن `account_name` لـ:
   - `'تعديل جرد'` إذا كان `ref_type = 'inventory_adjustment'`
   - `'تسوية إقفال'` إذا كان `ref_type = 'eod_reconciliation'`
   - `'—'` لأي ref_type آخر بـ account_name فارغ
3. توسيع واجهة `LedgerEntry` لتقبل `account_id: string | null` و`account_name: string | null`.

---

## إصلاح C-9 — حارس الساعة

**المشكلة:** تقديم ساعة الجهاز للوراء يسمح بتجاوز الإقفال اليومي. مثلاً: أُقفل اليوم 2026-06-17. يُغيّر المالك الساعة إلى 2026-06-16. `today = '2026-06-16'`، `isDayClosed('2026-06-16') = false`، فينجح البيع بتاريخ 2026-06-16 — فسد الإقفال.

**الإصلاح:**
- ملف جديد `src/lib/clockGuard.ts` يصدّر `assertClockNotTampered()`.
- الدالة تقرأ `last_known_date` من `app_settings` (مع cache في idb-keyval).
- إذا `today < last_known_date`، تُرمى رسالة خطأ عربية واضحة.
- إذا `today > last_known_date` أو `last_known_date == null`، تُحدّث القيمة وتُرجع `today`.
- تُستدعى في كل دالة تحوّر (12 موقعاً) + مرة عند الإقلاع في `App.tsx`.

**ضمانات الأمان (per owner's hard rules):**
1. **لا يُغلق المالك خارجاً عند أول تشغيل:** إذا `last_known_date == null` (أول تشغيل)، لا تُرمى خطأ — تُكتب اليوم كبذرة وتُرجع.
2. **لا يُغلق عند تقديم الساعة للأمام:** إذا `today > last_known_date` (اليوم التالي، أو تغيير منطقة زمنية)، تُحدّث القيمة وتُرجع `today` — لا خطأ.
3. **فقط عند تقديم الساعة للخلف** (`today < last_known_date`) تُرمى الخطأ.

**نص الخطأ العربي:**
> تم إرجاع ساعة الجهاز إلى YYYY-MM-DD بينما آخر تاريخ مسجّل هو YYYY-MM-DD. لا يمكن إجراء عمليات لتاريخ سابق لمنع فساد الإقفالات اليومية. صحّح تاريخ الجهاز ثم أعد المحاولة.

---

## خطوات التطبيق

1. انسخ `clockGuard.ts` إلى `src/lib/clockGuard.ts`.
2. انسخ `maintenance.ts` إلى `src/db/queries/maintenance.ts` (يستبدل الموجود).
3. انسخ `operations.ts` إلى `src/db/queries/operations.ts` (يستبدل الموجود).
4. افتح `call_site_edits.md` وطبّق تعديلات find/replace في الملفات الخمسة.
5. أعد `npm run dev` — لا SQL مطلوب.
6. اختبر السيناريوهات في قائمة التحقق.
