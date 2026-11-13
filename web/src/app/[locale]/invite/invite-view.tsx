"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite, type AcceptResult } from "@/api/invites";
import type { Messages } from "@/i18n/messages";
import { invitePath, receivedPath, loginHref, signupHref } from "@/i18n/paths";
import { buttonClass } from "../interview/form-bits";
const KEY = "mawareeth.invite-token";
function takeToken() {
  const token = window.location.hash.slice(1);
  if (token) {
    try { sessionStorage.setItem(KEY, token); } catch { /* Still usable this load. */ }
    history.replaceState(history.state, "", location.pathname + location.search);
    return token;
  }
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
export function InviteView({ messages, locale }: { messages: Messages; locale: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const token = takeToken();
    const timer = window.setTimeout(() => setToken(token), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [loaded, setLoaded] = useState<{ attempt: number; result: AcceptResult } | null>(null);
  useEffect(() => {
    if (!token || attempt === 0) return;
    const controller = new AbortController();
    void (async () => {
      const result = await acceptInvite(controller.signal, token);
      if (controller.signal.aborted) return;
      if (result.kind === "accepted" || result.kind === "unavailable") {
        try { sessionStorage.removeItem(KEY); } catch { /* Nothing to remove. */ }
      }
      if (result.kind === "accepted") router.replace(receivedPath(locale, result.id));
      setLoaded({ attempt, result });
    })();
    return () => controller.abort();
  }, [attempt, locale, router, token]);
  const text = messages.shared;
  const result = loaded?.attempt === attempt ? loaded.result : null;
  if (token === null) return <p role="alert">{text.unavailable}</p>;
  if (token && attempt === 0) return <button type="button" className={buttonClass} onClick={() => setAttempt(1)}>{messages.invites.accept}</button>;
  if (!result || result.kind === "accepted") return <p role="status">{text.loading}</p>;
  if (result.kind === "sign_in") return <div className="flex flex-col gap-3"><p>{text.signInTitle}</p><a className={buttonClass} href={loginHref(invitePath(locale))}>{text.signIn}</a><a className={buttonClass} href={signupHref(locale, invitePath(locale))}>{text.createAccount}</a></div>;
  if (result.kind === "unavailable") return <p role="alert">{text.unavailable}</p>;
  return <div><p role="alert">{result.kind === "throttled" ? text.throttled : text.error}</p><button className={buttonClass} onClick={() => setAttempt((n) => n + 1)}>{text.retry}</button></div>;
}
