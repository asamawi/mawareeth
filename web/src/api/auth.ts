import { write } from "./case";
import type { Locale } from "../i18n/messages";

export type AuthResult = { redirect?: string; errors?: Record<string, string[]>; error?: string; complete?: boolean; sent?: boolean; status: number };
export type AuthAction = "login" | "signup" | "logout" | "password-reset" | "password-reset/confirm";
export async function submitAuth(action: AuthAction, locale: Locale, data: Record<string, string>): Promise<AuthResult | null> {
  return write(new AbortController().signal, {}, {
    method: "POST", url: `/api/v1/auth/${action}/`, body: JSON.stringify(data),
    headers: { "Accept-Language": locale },
  }, async (response) => ({ ...await response.json(), status: response.status }));
}
export async function authDestination(locale: Locale, next: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`/api/v1/auth/login/?${new URLSearchParams({ next })}`, {
    credentials: "same-origin", headers: { "Accept-Language": locale }, signal,
  });
  if (!response.ok) throw new Error("Destination unavailable");
  return (await response.json()).redirect;
}
