import type { PresentedResult } from "@/contracts/presented";
import { terms } from "@/i18n/catalog.generated";

/** A notice's text: the served one, else the catalog's `notice.<code>`, else none. */
export function noticeText(presented: PresentedResult | undefined, code: "disclaimer" | "locale_beta", locale: string): string | null {
  const served = presented?.notices.find((notice) => notice.code === code)?.text;
  if (served) return served;
  const catalog = (terms as Record<string, Record<string, string> | undefined>)[locale];
  return catalog?.[`notice.${code}`] ?? null;
}
