import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/messages";
import { AuthForm } from "../auth-form";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AuthForm locale={locale} action="signup" />;
}
