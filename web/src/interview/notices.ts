import type { PresentedResult } from "@/contracts/presented";
import { terms } from "@/i18n/catalog.generated";

/** A notice's text: the served one, else the catalog's `notice.<code>`, else none. */
export function noticeText(presented: PresentedResult | undefined, code: "disclaimer" | "locale_beta", locale: string): string | null {
  const served = presented?.notices.find((notice) => notice.code === code)?.text;
  if (served) return served;
  const catalog = (terms as Record<string, Record<string, string> | undefined>)[locale];
  return catalog?.[`notice.${code}`] ?? null;
}

/** The supplied-facts notice: the family, and the estate amount when one was entered, were typed by the user. */
export function suppliedFactsText(locale: string, withAmount: boolean): string | null {
  const catalog = (terms as Record<string, Record<string, string> | undefined>)[locale];
  return catalog?.[withAmount ? "notice.supplied_facts" : "notice.supplied_facts_no_amount"] ?? null;
}
