/** "1/8" in the language's digits. The caller puts it in a left-to-right `bdi`. */
export function localFraction(fraction: string, locale: string): string {
  const format = new Intl.NumberFormat(locale, { useGrouping: false });
  return fraction
    .split("/")
    .map((part) => format.format(Number(part)))
    .join("/");
}

export function localPercent(percent: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(percent) / 100);
}

/** Kirat such as "3.43" in the language's digits, always 2 decimals, from the exact string. */
export function localKirat(kirat: string, locale: string): string {
  const [whole, fraction = "00"] = kirat.split(".");
  const format = new Intl.NumberFormat(locale, { useGrouping: false });
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
  const digits = fraction.padEnd(2, "0").slice(0, 2);
  return `${format.format(Number(whole))}${separator}${format.format(Number(digits[0]))}${format.format(Number(digits[1]))}`;
}
