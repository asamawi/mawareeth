import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isLocale } from "@/i18n/messages";
import { publicText } from "@/i18n/public-pages";
import { pageMetadata } from "@/seo/site";

import { focusRing, sectionClass } from "../ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const text = publicText[locale].about;
  return pageMetadata(locale, "about", { title: text.metaTitle, description: text.metaDescription });
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const text = publicText[locale].about;

  return (
    <main className={`${sectionClass} max-w-3xl`}>
      <h1 className="text-3xl font-semibold md:text-4xl">{text.heading}</h1>
      <div className="mt-8 flex flex-col gap-4 leading-relaxed">
        {text.history.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}

        <h2 className="mt-6 text-2xl font-semibold">{text.todayHeading}</h2>
        <ul className="list-disc space-y-2 ps-6">
          {text.todayItems.map((item) => <li key={item}>{item}</li>)}
        </ul>

        <h2 className="mt-6 text-2xl font-semibold">{text.limitsHeading}</h2>
        <p>{text.limitsBody}</p>

        <h2 className="mt-6 text-2xl font-semibold">{text.promiseHeading}</h2>
        <p>{text.promiseBody}</p>

        <h2 className="mt-6 text-2xl font-semibold">{text.contributeHeading}</h2>
        <p>
          {text.contributeBody}{" "}
          <a href="https://github.com/asamawi/mawareeth" rel="noopener noreferrer" className={`rounded underline underline-offset-4 ${focusRing}`}>
            {text.githubLabel}
          </a>
        </p>
      </div>
    </main>
  );
}
