import type { MadhabId, PreviewReason, RelationshipId } from "../api/case.ts";

export const locales = ["ar", "en", "fr"] as const;

export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export type Messages = {
  title: string;
  checking: string;
  connected: string;
  unavailable: string;
  nav: {
    label: string;
    home: string;
    interview: string;
    login: string;
    signup: string;
    language: string;
  };
  interview: {
    heading: string;
    noscript: string;
    loading: string;
    intro: string;
    start: string;
    starting: string;
    started: string;
    resumed: string;
    caseRef: string;
    deceasedHeading: string;
    genderLegend: string;
    genderMale: string;
    genderFemale: string;
    estateLabel: string;
    estateHint: string;
    deceasedSave: string;
    deceasedCancel: string;
    deceasedEdit: string;
    deceasedSummary: string;
    estateSummary: string;
    estateNone: string;
    heirsHeading: string;
    heirsEmpty: string;
    heirsListLabel: string;
    treeHeading: string;
    treeDeceasedMale: string;
    treeDeceasedFemale: string;
    /** Shown under a tree that has only the deceased. */
    treePrompt: string;
    /** `{deceased}` is the deceased text and `{heirs}` the counts, such as " Son: 2. Wife: 1.". */
    treeSummary: string;
    /** `{relationship}` and `{n}`: one entry of the description, such as "Son: 2.". */
    treeCount: string;
    heirRelationshipLabel: string;
    heirRelationshipPlaceholder: string;
    /** An option the server says would inherit nothing with the family so far; {relationship} is its name. */
    heirRelationshipBlocked: string;
    /** Under the add form's list, when an option is labelled. */
    heirNameLabel: string;
    heirNameHint: string;
    heirAdd: string;
    heirSave: string;
    heirCancel: string;
    /** The `{heir}` placeholder is the heir's name or relationship. */
    heirEdit: string;
    heirRemove: string;
    heirRemoveConfirm: string;
    heirRemoveYes: string;
    heirRemoveNo: string;
    /** `{heir}` is the relationship and `{n}` the number among unnamed heirs of that relationship. */
    heirNumbered: string;
    heirAddHeading: string;
    heirEditHeading: string;
    heirAdded: string;
    heirUpdated: string;
    heirRemoved: string;
    heirGone: string;
    formSaving: string;
    startOverConfirm: string;
    startOverYes: string;
    startOverNo: string;
    relationships: Record<RelationshipId, string>;
    /** Field name, then the error code the form or the server reports. */
    fieldErrors: Record<string, Record<string, string>> & Record<
      "gender" | "estate" | "relationship" | "name" | "heirs" | "case" | "same_as" | "death",
      Record<string, string>
    >;
    madhabLabel: string;
    madhabChange: string;
    madhabLegend: string;
    madhabDefaultNotice: string;
    madhabContinue: string;
    madhabCancel: string;
    madhabSaving: string;
    madhabs: Record<MadhabId, { name: string; description: string }>;
    existing: string;
    resume: string;
    startOver: string;
    expired: string;
    throttled: string;
    failed: string;
    retry: string;
    recheck: string;
    previewHeading: string;
    /** Shown while the case has no heir yet. */
    previewPrompt: string;
    previewWaiting: string;
    /** `{school}` is the school's name. */
    previewSchool: string;
    /** The one polite announcement when numbers appear. */
    previewUpdated: string;
    previewShare: string;
    previewAmount: string;
    previewNoShare: string;
    previewUnallocated: string;
    previewUnavailable: string;
    previewReasons: Record<PreviewReason, string>;
    previewFailed: string;
    previewThrottled: string;
    previewGone: string;
    /** There is no live case any more: no retry, the page needs reloading. */
    previewExpired: string;
    previewRetry: string;
  };
  cta: string;
};

export const messages: Record<Locale, Messages> = {
  ar: {
    title: "مواريث",
    checking: "جارٍ التحقق من الاتصال بالخدمة…",
    connected: "متصل بالخدمة.",
    unavailable: "الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا.",
    nav: {
      label: "التنقل الرئيسي",
      home: "مواريث",
      interview: "ابدأ حالة",
      login: "تسجيل الدخول",
      signup: "إنشاء حساب",
      language: "اللغة",
    },
    interview: {
      heading: "ابدأ حالة ميراث",
      noscript: "تتطلب هذه الصفحة تفعيل جافاسكربت. يرجى تفعيله في المتصفح ثم إعادة تحميل الصفحة.",
      loading: "جارٍ التحميل…",
      intro: "لا حاجة إلى حساب. تُحفظ حالتك على خادمنا لمدة 24 ساعة بعد آخر تغيير تجريه عليها.",
      start: "ابدأ الآن",
      starting: "جارٍ البدء…",
      started: "بدأت حالتك.",
      resumed: "أهلًا بعودتك. تمت متابعة حالتك.",
      caseRef: "رقم الحالة",
      deceasedHeading: "بيانات المتوفى",
      genderLegend: "جنس المتوفى",
      genderMale: "ذكر",
      genderFemale: "أنثى",
      estateLabel: "التركة القابلة للقسمة",
      estateHint: "اختياري. أدخل المبلغ المتبقي بعد سداد الديون ونفقات التجهيز والدفن والوصايا. يمكنك إضافته لاحقًا.",
      deceasedSave: "حفظ ومتابعة",
      deceasedCancel: "إلغاء",
      deceasedEdit: "تعديل بيانات المتوفى",
      deceasedSummary: "المتوفى",
      estateSummary: "التركة",
      estateNone: "لم تُدخل بعد",
      heirsHeading: "الورثة",
      heirsEmpty: "لم تضف أي وارث بعد.",
      heirsListLabel: "الورثة المضافون",
      treeHeading: "شجرة العائلة",
      treeDeceasedMale: "المتوفى (ذكر)",
      treeDeceasedFemale: "المتوفاة (أنثى)",
      treePrompt: "أضف أول وارث ليظهر في الشجرة.",
      treeSummary: "شجرة العائلة. {deceased}.{heirs}",
      treeCount: "{relationship}: {n}.",
      heirRelationshipLabel: "صلة القرابة بالمتوفى",
      heirRelationshipPlaceholder: "اختر صلة القرابة",
      heirRelationshipBlocked: "{relationship} (لا نصيب في الإرث مع الأسرة المسجّلة حتى الآن)",
      heirNameLabel: "الاسم (اختياري)",
      heirNameHint: "يمكنك ترك الاسم فارغًا، وسيظهر الوارث بصلة القرابة.",
      heirAdd: "إضافة وارث",
      heirSave: "حفظ التعديل",
      heirCancel: "إلغاء التعديل",
      heirEdit: "تعديل {heir}",
      heirRemove: "حذف {heir}",
      heirRemoveConfirm: "هل تريد حذف {heir}؟",
      heirRemoveYes: "نعم، احذف",
      heirRemoveNo: "إبقاء",
      heirNumbered: "{heir} رقم {n}",
      heirAddHeading: "إضافة وارث جديد",
      heirEditHeading: "تعديل بيانات الوارث",
      heirAdded: "تمت إضافة {heir}.",
      heirUpdated: "تم تعديل {heir}.",
      heirRemoved: "تم حذف {heir}.",
      heirGone: "هذا الوارث لم يعد موجودًا. تم تحديث القائمة.",
      formSaving: "جارٍ الحفظ…",
      startOverConfirm: "سيؤدي البدء من جديد إلى حذف المتوفى والورثة المدخلين في هذه الحالة. هل تريد المتابعة؟",
      startOverYes: "نعم، ابدأ من جديد",
      startOverNo: "لا، أبقِ حالتي",
      relationships: {
        father: "أب",
        mother: "أم",
        husband: "زوج",
        wife: "زوجة",
        son: "ابن",
        daughter: "بنت",
        son_of_son: "ابن الابن",
        daughter_of_son: "بنت الابن",
        grandfather: "جد",
        paternal_grandmother: "جدة لأب",
        maternal_grandmother: "جدة لأم",
        brother: "أخ شقيق",
        sister: "أخت شقيقة",
        paternal_brother: "أخ لأب",
        paternal_sister: "أخت لأب",
        maternal_brother: "أخ لأم",
        maternal_sister: "أخت لأم",
        son_of_brother: "ابن الأخ الشقيق",
        son_of_paternal_brother: "ابن الأخ لأب",
        uncle: "عم شقيق",
        paternal_uncle: "عم لأب",
        son_of_uncle: "ابن العم الشقيق",
        son_of_paternal_uncle: "ابن العم لأب",
      },
      fieldErrors: {
        gender: {
          required: "اختر جنس المتوفى.",
          invalid: "اختر ذكرًا أو أنثى.",
          has_husband: "هناك زوج مسجّل في هذه الأسرة، فلا يمكن أن يكون المتوفى ذكرًا. احذف الزوج أو اختر أنثى.",
          has_wife: "هناك زوجة مسجّلة في هذه الأسرة، فلا يمكن أن يكون المتوفى أنثى. احذف الزوجة أو اختر ذكرًا.",
          has_both_spouses: "سُجّل زوج وزوجة معًا، وهذا لا يصح مع أي جنس للمتوفى. احذف أحدهما ثم احفظ.",
        },
        estate: {
          invalid: "أدخل مبلغًا صحيحًا بالأرقام وفاصلة عشرية واحدة على الأكثر، بدون فاصل للآلاف.",
          not_positive: "يجب أن يكون المبلغ أكبر من صفر.",
          too_large: "المبلغ كبير جدًا. الحد الأقصى 15 رقمًا قبل الفاصلة.",
          decimals: "يُسمح بخانتين عشريتين على الأكثر.",
        },
        relationship: {
          // Native-language review pending.
          gender_locked: "هذا الشخص مرتبط بسجل آخر أو مسجل ضمن الوفيات، لذا لا يمكن تغيير جنسه. يرجى اختيار صلة قرابة من الجنس نفسه.",
          required: "اختر صلة القرابة.",
          invalid: "اختر صلة قرابة من القائمة.",
          second_father: "يمكن تسجيل أب واحد فقط. عدّل الأب المسجّل، أو اختر صلة قرابة أخرى لهذا القريب.",
          second_mother: "يمكن تسجيل أم واحدة فقط. عدّل الأم المسجّلة، أو اختر صلة قرابة أخرى لهذا القريب.",
          second_husband: "يمكن تسجيل زوج واحد فقط. عدّل الزوج المسجّل، أو اختر صلة قرابة أخرى لهذا القريب.",
          second_grandfather: "يمكن تسجيل جد واحد فقط. عدّل الجد المسجّل، أو اختر صلة قرابة أخرى لهذا القريب.",
          second_paternal_grandmother: "يمكن تسجيل جدة لأب واحدة فقط. عدّل الجدة لأب المسجّلة، أو اختر صلة قرابة أخرى لهذا القريب.",
          second_maternal_grandmother: "يمكن تسجيل جدة لأم واحدة فقط. عدّل الجدة لأم المسجّلة، أو اختر صلة قرابة أخرى لهذا القريب.",
          fifth_wife: "لا يزيد عدد الزوجات على أربع. عدّل إحدى الزوجات المسجّلات أو احذفها، أو اختر صلة قرابة أخرى لهذا القريب.",
          husband_of_male: "المتوفى مسجّل ذكرًا، ولا يكون للذكر زوج. اختر «زوجة» إن كنت تقصد القرينة، أو صحّح جنس المتوفى.",
          wife_of_female: "المتوفى مسجّل أنثى، ولا تكون للأنثى زوجة. اختر «زوج» إن كنت تقصد القرين، أو صحّح جنس المتوفى.",
        },
        // Native-language review pending.
        same_as: {
          gender_mismatch: "جنس الشخص المختار مختلف. يرجى اختيار شخص من الجنس نفسه أو تصحيح صلة القرابة.",
          not_alive: "لم يكن الشخص المختار على قيد الحياة عند هذه الوفاة. يرجى اختيار شخص كان حيًا آنذاك.",
          already_linked: "هذا الشخص موجود بالفعل ضمن هؤلاء الورثة. يرجى تعديل السجل الموجود أو اختيار شخص آخر.",
        },
        death: {
          order_required: "يلزم تحديد ترتيب هاتين الوفاتين. يرجى تحديد الشخص الذي توفي أولًا.",
          simultaneous: "الوفيات المتزامنة غير مدعومة. يرجى التحقق من ترتيب الوفاة والمتابعة فقط إذا كان معلومًا.",
          unknown: "ترتيب الوفاة المجهول غير مدعوم. يرجى التحقق من الشخص الذي توفي أولًا قبل المتابعة.",
          order_conflict: "ترتيب الوفاة المختار يتعارض مع الورثة المسجلين. يرجى مراجعة الترتيب وورثة كل شخص توفي.",
          limit: "تتضمن الحالة وفاتين لاحقتين بالفعل، وهو الحد المدعوم. يرجى إزالة وفاة مسجلة قبل إضافة أخرى.",
          already_deceased: "هذا الشخص مسجل ضمن الوفيات بالفعل. يرجى تعديل الوفاة المسجلة.",
        },
        name: { invalid: "الاسم يحتوي على رموز غير مسموحة.", too_long: "الاسم أطول من 100 حرف." },
        heirs: { limit: "بلغت الحد الأقصى وهو 50 وارثًا." },
        case: { deceased_required: "أدخل بيانات المتوفى أولًا." },
      },
      madhabLabel: "المذهب",
      madhabChange: "تغيير المذهب",
      madhabLegend: "اختر المذهب لهذه الحالة",
      madhabDefaultNotice: "تم اختيار المذهب الحنبلي افتراضيًا. اختر مذهبًا آخر إذا كان ينطبق على هذه الحالة.",
      madhabContinue: "متابعة",
      madhabCancel: "إبقاء الاختيار الحالي",
      madhabSaving: "جارٍ الحفظ…",
      madhabs: {
        hanafi: { name: "الحنفي", description: "مذهب سني ينتسب إلى الإمام أبي حنيفة" },
        maliki: { name: "المالكي", description: "مذهب سني ينتسب إلى الإمام مالك بن أنس" },
        shafii: { name: "الشافعي", description: "مذهب سني ينتسب إلى الإمام الشافعي" },
        hanbali: { name: "الحنبلي", description: "مذهب سني ينتسب إلى الإمام أحمد بن حنبل" },
        jafari: { name: "الجعفري", description: "مذهب شيعي ينتسب إلى الإمام جعفر الصادق" },
      },
      existing: "لديك حالة قائمة. هل تريد المتابعة أم البدء من جديد؟",
      resume: "متابعة حالتي",
      startOver: "البدء من جديد",
      expired: "انتهت صلاحية حالتك السابقة. يمكنك بدء حالة جديدة.",
      throttled: "عدد المحاولات كبير جدًا. يرجى المحاولة لاحقًا.",
      failed: "تعذر الاتصال بالخدمة. يرجى المحاولة مرة أخرى.",
      retry: "إعادة المحاولة",
      recheck: "التحقق مرة أخرى",
      previewHeading: "معاينة الأنصبة",
      previewPrompt: "أضف وارثًا لتظهر الأنصبة هنا.",
      previewWaiting: "جارٍ تحديث المعاينة…",
      previewSchool: "محسوبة وفق المذهب {school}. هذه معاينة وليست حكمًا نهائيًا.",
      previewUpdated: "تم تحديث معاينة الأنصبة.",
      previewShare: "النصيب",
      previewAmount: "المبلغ",
      previewNoShare: "لا نصيب له في هذه الحالة.",
      previewUnallocated: "الباقي غير الموزع على أي وارث",
      previewUnavailable: "المعاينة غير متاحة لهذه الحالة. يمكنك متابعة إضافة الورثة.",
      previewReasons: {
        // Native-language review pending.
        manasikhat_unsupported: "معاينة الوفيات المتعاقبة غير مدعومة لهذه الحالة. يرجى مراجعة البيانات وطلب مراجعة من مختص في المواريث.",
        school_not_supported: "المذهب الجعفري غير مدعوم بعد، فلا تُعرض أنصبة.",
        malikiyya_disputed: "اختلف علماء المذهب المالكي في هذه الحالة (المالكية)، فلا تُعرض أنصبة.",
        invalid_family: "هذه الأسرة غير ممكنة (مثل أكثر من أب واحد، أو زوج لمتوفى ذكر)، فلا تُعرض أنصبة. يرجى مراجعة الورثة.",
      },
      previewFailed: "تعذّر تحميل المعاينة. بيانات الأسرة محفوظة، ويمكنك المتابعة.",
      previewThrottled: "طلبات المعاينة كثيرة الآن. ستُجرَّب المعاينة مجددًا عند الحفظ التالي، ويمكنك المتابعة.",
      previewGone: "لا معاينة لهذه الحالة لأنها تغيّرت في نافذة أخرى.",
      previewExpired: "هذه الحالة لم تعد متاحة. أعد تحميل الصفحة للمتابعة.",
      previewRetry: "إعادة تحميل المعاينة",
    },
    cta: "ابدأ حالة بدون حساب",
  },
  en: {
    title: "Mawareeth",
    checking: "Checking the connection to the service…",
    connected: "Connected to the service.",
    unavailable: "The service is unavailable right now. Please try again later.",
    nav: {
      label: "Main navigation",
      home: "Mawareeth",
      interview: "Start a case",
      login: "Log in",
      signup: "Sign up",
      language: "Language",
    },
    interview: {
      heading: "Start an inheritance case",
      noscript: "This page needs JavaScript. Please turn it on in your browser and reload the page.",
      loading: "Loading…",
      intro: "No account needed. Your case is kept on our server for 24 hours after your last change.",
      start: "Start now",
      starting: "Starting…",
      started: "Your case has started.",
      resumed: "Welcome back. Your case has been resumed.",
      caseRef: "Case reference",
      deceasedHeading: "About the deceased",
      genderLegend: "Gender of the deceased",
      genderMale: "Male",
      genderFemale: "Female",
      estateLabel: "Estate to divide",
      estateHint: "Optional. Enter the amount left after debts, funeral costs and bequests. You can add this later.",
      deceasedSave: "Save and continue",
      deceasedCancel: "Cancel",
      deceasedEdit: "Edit the deceased",
      deceasedSummary: "The deceased",
      estateSummary: "Estate to divide",
      estateNone: "Not entered yet",
      heirsHeading: "Heirs",
      heirsEmpty: "You have not added any heirs yet.",
      heirsListLabel: "Heirs added",
      treeHeading: "Family tree",
      treeDeceasedMale: "The deceased, male",
      treeDeceasedFemale: "The deceased, female",
      treePrompt: "Add the first heir to see them in the tree.",
      treeSummary: "Family tree. {deceased}.{heirs}",
      treeCount: "{relationship}: {n}.",
      heirRelationshipLabel: "Relationship to the deceased",
      heirRelationshipPlaceholder: "Choose a relationship",
      heirRelationshipBlocked: "{relationship} (does not inherit with the family so far)",
      heirNameLabel: "Name (optional)",
      heirNameHint: "You can leave the name empty. The heir will be shown by relationship.",
      heirAdd: "Add heir",
      heirSave: "Save changes",
      heirCancel: "Cancel editing",
      heirEdit: "Edit {heir}",
      heirRemove: "Remove {heir}",
      heirRemoveConfirm: "Remove {heir}?",
      heirRemoveYes: "Yes, remove",
      heirRemoveNo: "Keep",
      heirNumbered: "{heir} {n}",
      heirAddHeading: "Add an heir",
      heirEditHeading: "Edit heir",
      heirAdded: "{heir} added.",
      heirUpdated: "{heir} updated.",
      heirRemoved: "{heir} removed.",
      heirGone: "That heir no longer exists. The list has been refreshed.",
      formSaving: "Saving…",
      startOverConfirm: "Starting over deletes the deceased and the heirs entered in this case. Do you want to continue?",
      startOverYes: "Yes, start over",
      startOverNo: "No, keep my case",
      relationships: {
        father: "Father",
        mother: "Mother",
        husband: "Husband",
        wife: "Wife",
        son: "Son",
        daughter: "Daughter",
        son_of_son: "Son's son",
        daughter_of_son: "Son's daughter",
        grandfather: "Grandfather",
        paternal_grandmother: "Paternal grandmother",
        maternal_grandmother: "Maternal grandmother",
        brother: "Full brother",
        sister: "Full sister",
        paternal_brother: "Half-brother (same father)",
        paternal_sister: "Half-sister (same father)",
        maternal_brother: "Half-brother (same mother)",
        maternal_sister: "Half-sister (same mother)",
        son_of_brother: "Full brother's son",
        son_of_paternal_brother: "Half-brother's son (same father)",
        uncle: "Paternal uncle (father's full brother)",
        paternal_uncle: "Paternal uncle (father's half-brother)",
        son_of_uncle: "Son of father's full brother",
        son_of_paternal_uncle: "Son of father's half-brother",
      },
      fieldErrors: {
        gender: {
          required: "Choose the gender of the deceased.",
          invalid: "Choose male or female.",
          has_husband: "A husband is saved in this family, so the deceased cannot be male. Remove the husband, or choose female.",
          has_wife: "A wife is saved in this family, so the deceased cannot be female. Remove the wife, or choose male.",
          has_both_spouses: "A husband and a wife are both saved, which fits neither gender. Remove one of them, then save.",
        },
        estate: {
          invalid: "Enter a valid amount using digits and at most one decimal separator. Do not use thousands separators.",
          not_positive: "The amount must be greater than zero.",
          too_large: "The amount is too large. Use at most 15 digits before the decimal point.",
          decimals: "Use at most 2 decimal places.",
        },
        relationship: {
          gender_locked: "This person is linked or recorded as deceased, so their gender cannot change. Choose a relationship with the same gender.",
          required: "Choose a relationship.",
          invalid: "Choose a relationship from the list.",
          second_father: "Only one father can be recorded. Edit the saved father, or choose another relationship for this relative.",
          second_mother: "Only one mother can be recorded. Edit the saved mother, or choose another relationship for this relative.",
          second_husband: "Only one husband can be recorded. Edit the saved husband, or choose another relationship for this relative.",
          second_grandfather: "Only one grandfather can be recorded. Edit the saved grandfather, or choose another relationship for this relative.",
          second_paternal_grandmother: "Only one paternal grandmother can be recorded. Edit the saved paternal grandmother, or choose another relationship for this relative.",
          second_maternal_grandmother: "Only one maternal grandmother can be recorded. Edit the saved maternal grandmother, or choose another relationship for this relative.",
          fifth_wife: "At most four wives can be recorded. Edit or remove one of the saved wives, or choose another relationship for this relative.",
          husband_of_male: "The deceased is recorded as male, and a male has no husband. Choose wife if you meant the spouse, or correct the gender of the deceased.",
          wife_of_female: "The deceased is recorded as female, and a female has no wife. Choose husband if you meant the spouse, or correct the gender of the deceased.",
        },
        same_as: {
          gender_mismatch: "The selected person has a different gender. Choose a person with the same gender, or correct the relationship.",
          not_alive: "The selected person was not alive at this death. Choose someone who was alive then.",
          already_linked: "This person is already included among these heirs. Edit the existing entry, or choose another person.",
        },
        death: {
          order_required: "The order of these deaths is needed. Choose which person died first.",
          simultaneous: "Simultaneous deaths are not supported. Check the death order; continue only if it is known.",
          unknown: "An unknown death order is not supported. Check which person died first before continuing.",
          order_conflict: "The chosen death order conflicts with the recorded heirs. Check the order and the heirs of each person who died.",
          limit: "This case already has two later deaths, the supported limit. Remove a recorded death before adding another.",
          already_deceased: "This person is already recorded as deceased. Edit the existing death instead.",
        },
        name: {
          invalid: "The name contains characters that are not allowed.",
          too_long: "The name is longer than 100 characters.",
        },
        heirs: { limit: "You have reached the limit of 50 heirs." },
        case: { deceased_required: "Enter the deceased first." },
      },
      madhabLabel: "School of law",
      madhabChange: "Change Madhab",
      madhabLegend: "Choose the school of law (Madhab) for this case",
      madhabDefaultNotice: "Hanbali is selected by default. Choose another school if it applies to this case.",
      madhabContinue: "Continue",
      madhabCancel: "Keep current choice",
      madhabSaving: "Saving…",
      madhabs: {
        hanafi: { name: "Hanafi", description: "Sunni school named after Imam Abu Hanifa" },
        maliki: { name: "Maliki", description: "Sunni school named after Imam Malik ibn Anas" },
        shafii: { name: "Shafi'i", description: "Sunni school named after Imam al-Shafi'i" },
        hanbali: { name: "Hanbali", description: "Sunni school named after Imam Ahmad ibn Hanbal" },
        jafari: { name: "Jafari", description: "Shia school named after Imam Jafar al-Sadiq" },
      },
      existing: "You already have a case in progress. Would you like to resume it or start over?",
      resume: "Resume my case",
      startOver: "Start over",
      expired: "Your previous case has expired. You can start a new one.",
      throttled: "Too many attempts. Please try again later.",
      failed: "We could not reach the service. Please try again.",
      retry: "Try again",
      recheck: "Check again",
      previewHeading: "Share preview",
      previewPrompt: "Add an heir to see the shares here.",
      previewWaiting: "Updating the preview…",
      previewSchool: "Calculated under the {school} school. This is a preview, not a final ruling.",
      previewUpdated: "The share preview was updated.",
      previewShare: "Share",
      previewAmount: "Amount",
      previewNoShare: "Receives no share in this case.",
      previewUnallocated: "Remainder not allocated to any heir",
      previewUnavailable: "A preview is not available for this case. You can keep adding heirs.",
      previewReasons: {
        manasikhat_unsupported: "A preview for successive deaths is not supported for this case. Check the details and seek a qualified inheritance review.",
        school_not_supported: "The Jafari school is not supported yet, so no shares are shown.",
        malikiyya_disputed: "Scholars of the Maliki school disagree about this family (the Malikiyya case), so no shares are shown.",
        invalid_family: "This family is not possible (for example two fathers, or a husband for a male deceased), so no shares are shown. Please check the heirs.",
      },
      previewFailed: "The preview could not be loaded. Your family details are saved, and you can continue.",
      previewThrottled: "There are too many preview requests right now. The preview will try again at your next save, and you can continue.",
      previewGone: "There is no preview for this case because it changed in another tab.",
      previewExpired: "This case is no longer available. Reload the page to continue.",
      previewRetry: "Reload the preview",
    },
    cta: "Start a case without an account",
  },
  fr: {
    title: "Mawareeth",
    checking: "Vérification de la connexion au service…",
    connected: "Connecté au service.",
    unavailable: "Le service est indisponible pour le moment. Veuillez réessayer plus tard.",
    nav: {
      label: "Navigation principale",
      home: "Mawareeth",
      interview: "Commencer un dossier",
      login: "Connexion",
      signup: "Créer un compte",
      language: "Langue",
    },
    interview: {
      heading: "Commencer un dossier de succession",
      noscript: "Cette page nécessite JavaScript. Veuillez l'activer dans votre navigateur puis recharger la page.",
      loading: "Chargement…",
      intro: "Aucun compte requis. Votre dossier est conservé sur notre serveur pendant 24 heures après votre dernière modification.",
      start: "Commencer",
      starting: "Démarrage…",
      started: "Votre dossier a commencé.",
      resumed: "Bon retour. Votre dossier a été repris.",
      caseRef: "Référence du dossier",
      deceasedHeading: "Informations sur le défunt",
      genderLegend: "Sexe du défunt",
      genderMale: "Homme",
      genderFemale: "Femme",
      estateLabel: "Succession à partager",
      estateHint: "Facultatif. Indiquez le montant restant après les dettes, les frais funéraires et les legs. Vous pourrez l'ajouter plus tard.",
      deceasedSave: "Enregistrer et continuer",
      deceasedCancel: "Annuler",
      deceasedEdit: "Modifier le défunt",
      deceasedSummary: "Le défunt",
      estateSummary: "Succession",
      estateNone: "Pas encore renseigné",
      heirsHeading: "Héritiers",
      heirsEmpty: "Vous n'avez pas encore ajouté d'héritier.",
      heirsListLabel: "Héritiers ajoutés",
      treeHeading: "Arbre généalogique",
      treeDeceasedMale: "Le défunt, homme",
      treeDeceasedFemale: "La défunte, femme",
      treePrompt: "Ajoutez le premier héritier pour le voir dans l'arbre.",
      treeSummary: "Arbre généalogique. {deceased}.{heirs}",
      treeCount: "{relationship} : {n}.",
      heirRelationshipLabel: "Lien avec le défunt",
      heirRelationshipPlaceholder: "Choisissez un lien de parenté",
      heirRelationshipBlocked: "{relationship} (n'hérite pas avec la famille saisie jusqu'ici)",
      heirNameLabel: "Nom (facultatif)",
      heirNameHint: "Vous pouvez laisser le nom vide. L'héritier sera affiché par son lien de parenté.",
      heirAdd: "Ajouter l'héritier",
      heirSave: "Enregistrer les modifications",
      heirCancel: "Annuler la modification",
      heirEdit: "Modifier {heir}",
      heirRemove: "Supprimer {heir}",
      heirRemoveConfirm: "Supprimer l'héritier {heir} ?",
      heirRemoveYes: "Oui, supprimer",
      heirRemoveNo: "Garder",
      heirNumbered: "{heir} n° {n}",
      heirAddHeading: "Ajouter un héritier",
      heirEditHeading: "Modifier l'héritier",
      heirAdded: "Héritier ajouté : {heir}",
      heirUpdated: "Héritier modifié : {heir}",
      heirRemoved: "Héritier supprimé : {heir}",
      heirGone: "Cet héritier n'existe plus. La liste a été actualisée.",
      formSaving: "Enregistrement…",
      startOverConfirm: "Recommencer supprime le défunt et les héritiers saisis dans ce dossier. Voulez-vous continuer ?",
      startOverYes: "Oui, recommencer",
      startOverNo: "Non, garder mon dossier",
      relationships: {
        father: "Père",
        mother: "Mère",
        husband: "Époux",
        wife: "Épouse",
        son: "Fils",
        daughter: "Fille",
        son_of_son: "Fils du fils",
        daughter_of_son: "Fille du fils",
        grandfather: "Grand-père",
        paternal_grandmother: "Grand-mère paternelle",
        maternal_grandmother: "Grand-mère maternelle",
        brother: "Frère germain",
        sister: "Sœur germaine",
        paternal_brother: "Frère consanguin",
        paternal_sister: "Sœur consanguine",
        maternal_brother: "Frère utérin",
        maternal_sister: "Sœur utérine",
        son_of_brother: "Fils du frère germain",
        son_of_paternal_brother: "Fils du frère consanguin",
        uncle: "Oncle paternel germain",
        paternal_uncle: "Oncle paternel consanguin",
        son_of_uncle: "Fils de l'oncle germain",
        son_of_paternal_uncle: "Fils de l'oncle consanguin",
      },
      fieldErrors: {
        gender: {
          required: "Choisissez le sexe du défunt.",
          invalid: "Choisissez homme ou femme.",
          has_husband: "Un mari est enregistré dans cette famille, le défunt ne peut donc pas être un homme. Retirez le mari, ou choisissez femme.",
          has_wife: "Une épouse est enregistrée dans cette famille, le défunt ne peut donc pas être une femme. Retirez l'épouse, ou choisissez homme.",
          has_both_spouses: "Un mari et une épouse sont tous deux enregistrés, ce qui ne convient à aucun sexe. Retirez l'un des deux, puis enregistrez.",
        },
        estate: {
          invalid: "Saisissez un montant valide : des chiffres et au plus un séparateur décimal, sans séparateur de milliers.",
          not_positive: "Le montant doit être supérieur à zéro.",
          too_large: "Le montant est trop grand. Utilisez au plus 15 chiffres avant la virgule.",
          decimals: "Utilisez au plus 2 décimales.",
        },
        relationship: {
          // Native-language review pending.
          gender_locked: "Cette personne est liée à une autre entrée ou son décès est enregistré ; son sexe ne peut pas changer. Choisissez un lien de parenté du même sexe.",
          required: "Choisissez un lien de parenté.",
          invalid: "Choisissez un lien dans la liste.",
          second_father: "Un seul père peut être enregistré. Modifiez le père enregistré, ou choisissez un autre lien pour ce parent.",
          second_mother: "Une seule mère peut être enregistrée. Modifiez la mère enregistrée, ou choisissez un autre lien pour ce parent.",
          second_husband: "Un seul mari peut être enregistré. Modifiez le mari enregistré, ou choisissez un autre lien pour ce parent.",
          second_grandfather: "Un seul grand-père peut être enregistré. Modifiez le grand-père enregistré, ou choisissez un autre lien pour ce parent.",
          second_paternal_grandmother: "Une seule grand-mère paternelle peut être enregistrée. Modifiez la grand-mère paternelle enregistrée, ou choisissez un autre lien pour ce parent.",
          second_maternal_grandmother: "Une seule grand-mère maternelle peut être enregistrée. Modifiez la grand-mère maternelle enregistrée, ou choisissez un autre lien pour ce parent.",
          fifth_wife: "Au plus quatre épouses peuvent être enregistrées. Modifiez ou retirez l'une des épouses enregistrées, ou choisissez un autre lien pour ce parent.",
          husband_of_male: "Le défunt est enregistré comme un homme, et un homme n'a pas de mari. Choisissez épouse si vous parliez du conjoint, ou corrigez le sexe du défunt.",
          wife_of_female: "Le défunt est enregistré comme une femme, et une femme n'a pas d'épouse. Choisissez mari si vous parliez du conjoint, ou corrigez le sexe du défunt.",
        },
        // Native-language review pending.
        same_as: {
          gender_mismatch: "Le sexe de la personne choisie est différent. Choisissez une personne du même sexe ou corrigez le lien de parenté.",
          not_alive: "La personne choisie ne vivait plus lors de ce décès. Choisissez une personne encore en vie à ce moment-là.",
          already_linked: "Cette personne figure déjà parmi ces héritiers. Modifiez l'entrée existante ou choisissez une autre personne.",
        },
        death: {
          order_required: "L'ordre de ces décès est nécessaire. Indiquez quelle personne est décédée en premier.",
          simultaneous: "Les décès simultanés ne sont pas pris en charge. Vérifiez leur ordre et continuez uniquement si cet ordre est connu.",
          unknown: "Un ordre de décès inconnu n'est pas pris en charge. Vérifiez quelle personne est décédée en premier avant de continuer.",
          order_conflict: "L'ordre choisi contredit les héritiers enregistrés. Vérifiez cet ordre et les héritiers de chaque personne décédée.",
          limit: "Ce dossier comporte déjà deux décès ultérieurs, la limite prise en charge. Retirez un décès enregistré avant d'en ajouter un autre.",
          already_deceased: "Le décès de cette personne est déjà enregistré. Modifiez le décès existant.",
        },
        name: {
          invalid: "Le nom contient des caractères non autorisés.",
          too_long: "Le nom dépasse 100 caractères.",
        },
        heirs: { limit: "Vous avez atteint la limite de 50 héritiers." },
        case: { deceased_required: "Saisissez d'abord le défunt." },
      },
      madhabLabel: "École juridique",
      madhabChange: "Changer d'école",
      madhabLegend: "Choisissez l'école juridique (madhab) pour ce dossier",
      madhabDefaultNotice: "L'école hanbalite est sélectionnée par défaut. Choisissez une autre école si elle s'applique à ce dossier.",
      madhabContinue: "Continuer",
      madhabCancel: "Garder le choix actuel",
      madhabSaving: "Enregistrement…",
      madhabs: {
        hanafi: { name: "Hanafite", description: "École sunnite nommée d'après l'imam Abu Hanifa" },
        maliki: { name: "Malikite", description: "École sunnite nommée d'après l'imam Malik ibn Anas" },
        shafii: { name: "Chaféite", description: "École sunnite nommée d'après l'imam al-Shafi'i" },
        hanbali: { name: "Hanbalite", description: "École sunnite nommée d'après l'imam Ahmad ibn Hanbal" },
        jafari: { name: "Jaafarite", description: "École chiite nommée d'après l'imam Jafar al-Sadiq" },
      },
      existing: "Vous avez déjà un dossier en cours. Souhaitez-vous le reprendre ou recommencer ?",
      resume: "Reprendre mon dossier",
      startOver: "Recommencer",
      expired: "Votre dossier précédent a expiré. Vous pouvez en commencer un nouveau.",
      throttled: "Trop de tentatives. Veuillez réessayer plus tard.",
      failed: "Impossible de joindre le service. Veuillez réessayer.",
      retry: "Réessayer",
      recheck: "Vérifier à nouveau",
      previewHeading: "Aperçu des parts",
      previewPrompt: "Ajoutez un héritier pour voir les parts ici.",
      previewWaiting: "Mise à jour de l'aperçu…",
      previewSchool: "Calculé selon l'école {school}. Il s'agit d'un aperçu, pas d'une décision définitive.",
      previewUpdated: "L'aperçu des parts a été mis à jour.",
      previewShare: "Part",
      previewAmount: "Montant",
      previewNoShare: "Ne reçoit aucune part dans ce cas.",
      previewUnallocated: "Reste non attribué à un héritier",
      previewUnavailable: "Aucun aperçu n'est disponible pour ce cas. Vous pouvez continuer à ajouter des héritiers.",
      previewReasons: {
        // Native-language review pending.
        manasikhat_unsupported: "L'aperçu des décès successifs n'est pas pris en charge pour ce cas. Vérifiez les informations et demandez un examen par une personne qualifiée en successions.",
        school_not_supported: "L'école jafarite n'est pas encore prise en charge, aucune part n'est donc affichée.",
        malikiyya_disputed: "Les savants de l'école malikite divergent sur cette famille (le cas de la Malikiyya), aucune part n'est donc affichée.",
        invalid_family: "Cette famille n'est pas possible (par exemple deux pères, ou un mari pour un défunt de sexe masculin), aucune part n'est donc affichée. Vérifiez les héritiers.",
      },
      previewFailed: "L'aperçu n'a pas pu être chargé. Les informations de la famille sont enregistrées et vous pouvez continuer.",
      previewThrottled: "Il y a trop de demandes d'aperçu en ce moment. L'aperçu sera réessayé à votre prochain enregistrement, et vous pouvez continuer.",
      previewGone: "Il n'y a pas d'aperçu pour ce cas, car il a changé dans un autre onglet.",
      previewExpired: "Ce cas n'est plus disponible. Rechargez la page pour continuer.",
      previewRetry: "Recharger l'aperçu",
    },
    cta: "Commencer un dossier sans compte",
  },
};
