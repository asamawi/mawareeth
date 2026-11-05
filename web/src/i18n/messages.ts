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
};

export const messages: Record<Locale, Messages> = {
  ar: {
    title: "مواريث",
    checking: "جارٍ التحقق من الاتصال بالخدمة…",
    connected: "متصل بالخدمة.",
    unavailable: "الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا.",
  },
  en: {
    title: "Mawareeth",
    checking: "Checking the connection to the service…",
    connected: "Connected to the service.",
    unavailable: "The service is unavailable right now. Please try again later.",
  },
  fr: {
    title: "Mawareeth",
    checking: "Vérification de la connexion au service…",
    connected: "Connecté au service.",
    unavailable: "Le service est indisponible pour le moment. Veuillez réessayer plus tard.",
  },
};
