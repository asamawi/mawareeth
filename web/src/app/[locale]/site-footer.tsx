import Link from "next/link";

import type { Locale, Messages } from "@/i18n/messages";

const linkClass =
  "rounded px-1 underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

export function SiteFooter({ locale, footer }: { locale: Locale; footer: Messages["footer"] }) {
  return (
    <footer className="mt-auto border-t border-line bg-surface px-6 py-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 text-sm">
        <nav aria-label={footer.label}>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {/* No prefetch: the static export lays its prefetch files out where Django answers 404. */}
            <li><Link href={`/${locale}/about/`} prefetch={false} className={linkClass}>{footer.about}</Link></li>
            <li><Link href={`/${locale}/terms/`} prefetch={false} className={linkClass}>{footer.terms}</Link></li>
            <li><Link href={`/${locale}/privacy/`} prefetch={false} className={linkClass}>{footer.privacy}</Link></li>
          </ul>
        </nav>
        <p className="text-muted">{footer.note}</p>
      </div>
    </footer>
  );
}
