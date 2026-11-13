import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { isLocale, messages } from "@/i18n/messages";
import { publicText } from "@/i18n/public-pages";
import { landingJsonLd } from "@/seo/json-ld";
import { pageMetadata } from "@/seo/site";

import { JsonLd } from "./json-ld";
import { LandingRedirect } from "./landing-redirect";
import { cardClass, primaryButton, secondaryButton, sectionClass } from "./ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const text = publicText[locale].landing;
  return pageMetadata(locale, "", { title: text.metaTitle, description: text.metaDescription });
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.8 2.8L16 9.5" />
    </svg>
  );
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const all = publicText[locale];
  const text = all.landing;
  const interviewHref = `/${locale}/interview/`;

  return (
    <main>
      <JsonLd data={landingJsonLd(locale, messages[locale].title, all)} />
      <LandingRedirect locale={locale} />

      <section className={`${sectionClass} md:py-24`} aria-labelledby="hero-heading">
        <p className="text-sm font-semibold text-accent">{text.eyebrow}</p>
        <h1 id="hero-heading" className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-balance md:text-5xl md:leading-tight">
          {text.heading}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted md:text-xl md:leading-relaxed">{text.lede}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {/* No prefetch: the static export lays its prefetch files out where Django answers 404. */}
          <Link href={interviewHref} prefetch={false} className={primaryButton}>{text.cta}</Link>
          <a href="#how" className={secondaryButton}>{text.secondary}</a>
        </div>
        <p className="mt-4 text-sm text-muted">{text.note}</p>
      </section>

      <section id="how" className={`${sectionClass} scroll-mt-4`} aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-2xl font-semibold md:text-3xl">{text.howHeading}</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {text.steps.map((step, index) => (
            <li key={step.title} className={cardClass}>
              <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-accent text-base font-semibold text-accent-foreground">{index + 1}</span>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={sectionClass} aria-labelledby="coverage-heading">
        <h2 id="coverage-heading" className="text-2xl font-semibold md:text-3xl">{text.coverageHeading}</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {text.coverage.map((item) => (
            <li key={item.title} className={`${cardClass} flex gap-3`}>
              <CheckIcon />
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionClass} aria-labelledby="disclaimer-heading">
        <div className="rounded-e-xl border-s-4 border-accent bg-surface p-6 md:p-8">
          <h2 id="disclaimer-heading" className="text-xl font-semibold md:text-2xl">{text.disclaimerHeading}</h2>
          <p className="mt-3 max-w-3xl leading-relaxed">{text.disclaimer}</p>
        </div>
      </section>

      <section id="faq" className={`${sectionClass} scroll-mt-4`} aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-2xl font-semibold md:text-3xl">{all.faq.heading}</h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {all.faq.items.map((item) => (
            <article key={item.q} className={cardClass}>
              <h3 className="text-lg font-semibold">{item.q}</h3>
              <p className="mt-2 leading-relaxed text-muted">{item.a}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${sectionClass} text-center`} aria-labelledby="final-heading">
        <h2 id="final-heading" className="text-2xl font-semibold md:text-3xl">{text.finalHeading}</h2>
        <p className="mx-auto mt-3 max-w-xl text-lg text-muted">{text.finalBody}</p>
        <div className="mt-6">
          <Link href={interviewHref} prefetch={false} className={primaryButton}>{text.cta}</Link>
        </div>
      </section>
    </main>
  );
}
