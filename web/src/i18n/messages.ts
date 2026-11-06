import type { MadhabId } from "../api/case.ts";

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
    firstQuestionHeading: string;
    firstQuestionText: string;
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
      firstQuestionHeading: "السؤال الأول",
      firstQuestionText: "من هو المتوفى؟ سنسألك عن بياناته في الخطوة التالية.",
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
      firstQuestionHeading: "First question",
      firstQuestionText: "Who has passed away? We will ask for their details in the next step.",
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
      firstQuestionHeading: "Première question",
      firstQuestionText: "Qui est décédé ? Nous vous demanderons ses informations à l'étape suivante.",
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
    },
    cta: "Commencer un dossier sans compte",
  },
};
