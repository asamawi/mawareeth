"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { submitAuth, authDestination, passwordChangeStatus, type AuthAction } from "@/api/auth";
import { loginHref } from "@/i18n/paths";
import { readCsrfToken } from "@/api/case";
import { fetchSession } from "@/api/session";
import { messages, type Locale } from "@/i18n/messages";

export function AuthForm({ locale, action }: { locale: Locale; action: Exclude<AuthAction, "logout"> }) {
  const t = messages[locale].auth;
  const formRef = useRef<HTMLFormElement>(null);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [tokenValid, setTokenValid] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const [csrf, setCsrf] = useState("");
  const [next, setNext] = useState("");
  const title = action === "password-change" ? t.change : action === "password-reset" ? t.reset : action === "password-reset/confirm" ? t.confirm : t[action];
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(window.location.search);
    const destination = query.get("next") ?? "";
    // Read browser-only continuation state after hydration, independently of network requests.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNext(destination);
    setTokenValid(false);
    setHasPassword(null);
    if (action === "password-change") {
      passwordChangeStatus(locale, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        if (result.status === 403) window.location.assign(loginHref(`/${locale}/password-change/`));
        else if (result.status === 200 && typeof result.has_password === "boolean") setHasPassword(result.has_password);
        else setNotice(result.status === 429 ? t.throttled : t.error);
      }).catch(() => { if (!controller.signal.aborted) setNotice(t.error); });
    }
    if (query.get("error") === "social") setNotice(t.socialError);
    fetchSession(controller.signal).then(async (session) => {
      if (controller.signal.aborted) return;
      setCsrf(readCsrfToken() ?? "");
      if (session.authenticated && (action === "login" || action === "signup")) {
        const redirect = await authDestination(locale, destination, controller.signal);
        if (!controller.signal.aborted) window.location.assign(redirect);
      }
    }).catch(() => { if (!controller.signal.aborted) setNotice(t.error); });
    if (action === "password-reset/confirm") {
      const params = new URLSearchParams({ uid: query.get("uid") ?? "", token: query.get("token") ?? "" });
      fetch(`/api/v1/auth/password-reset/confirm/?${params}`, { credentials: "same-origin", signal: controller.signal, headers: { "Accept-Language": locale } })
        .then(async (response) => { if (controller.signal.aborted) return; if (response.ok) setTokenValid(true); else if (response.status === 400 && (await response.json()).error === "invalid_link") setInvalid(true); else if (!response.ok) setNotice(response.status === 429 ? t.throttled : t.error); })
        .catch(() => { if (!controller.signal.aborted) setNotice(t.error); });
    }
    return () => controller.abort();
  }, [action, locale, t]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || !Object.keys(errors).length) return;
    const target = action === "login" && errors.__all__
      ? form.querySelector<HTMLElement>('[data-form-error]')
      : form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form.querySelector<HTMLElement>('[data-form-error]');
    target?.focus();
  }, [errors, action]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action === "password-reset/confirm" && !tokenValid) return;
    if (action === "password-change" && hasPassword !== true) return;
    const form = event.currentTarget;
    setPending(true); setErrors({}); setNotice("");
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const query = new URLSearchParams(window.location.search);
    const result = await submitAuth(action, locale, { ...data, next: query.get("next") ?? "", uid: query.get("uid") ?? "", token: query.get("token") ?? "" });
    setPending(false);
    if (!result) { setNotice(t.error); return; }
    if (result.status === 429) { setNotice(t.throttled); return; }
    if (action === "password-change" && result.status === 403) { window.location.assign(loginHref(`/${locale}/password-change/`)); return; }
    if (action === "password-change" && result.error === "no_password") { setHasPassword(false); return; }
    if (result.error === "invalid_link") { setInvalid(true); return; }
    if (result.errors) {
      setErrors(result.errors);
      if (action === "login") (form.elements.namedItem("password") as HTMLInputElement).value = "";
      return;
    }
    if (result.status >= 400) { setNotice(t.error); return; }
    if (result.redirect) { window.location.assign(result.redirect); return; }
    setDone(true); setNotice(action === "password-reset" ? t.sent : t.complete);
  }
  const fields = action === "login" ? ["username", "password"] : action === "signup" ? ["username", "email", "password1", "password2"] : action === "password-reset" ? ["email"] : action === "password-change" ? ["old_password", "new_password1", "new_password2"] : ["new_password1", "new_password2"];
  function label(field: string) { return field === "password1" ? t.password : t[field as keyof typeof t]; }
  return <main className="mx-auto max-w-lg space-y-5 p-6" dir={locale === "ar" ? "rtl" : "ltr"}>
    <h1 className="text-2xl font-semibold">{title}</h1>
    {notice && <p role="status">{notice}</p>}
    {action === "password-change" && hasPassword === false ? <p role="status">{t.noPassword}</p> : invalid ? <p role="alert">{t.invalid}</p> : !done && <form ref={formRef} method="post" onSubmit={submit} className="space-y-4">
      {errors.__all__?.map((error) => <p role="alert" tabIndex={-1} data-form-error key={error}>{error}</p>)}
      {fields.map((field) => <div key={field}>
        <label htmlFor={field} className="block">{label(field)}</label>
        <input className="w-full rounded border p-2" id={field} name={field} required
          type={field.includes("password") ? "password" : field === "email" ? "email" : "text"}
          autoComplete={field.includes("password") ? (action === "login" || field === "old_password") ? "current-password" : "new-password" : field === "email" ? "email" : "username"}
          aria-invalid={!!errors[field]} aria-describedby={[...(field === "password1" || field === "new_password1" ? ["password-requirements"] : []), ...(errors[field] ? [`${field}-errors`] : [])].join(" ") || undefined} />
        {(field === "password1" || field === "new_password1") && <p id="password-requirements">{t.passwordRequirements}</p>}
        {errors[field] && <div id={`${field}-errors`}>{errors[field].map((error) => <p role="alert" key={error}>{error}</p>)}</div>}
      </div>)}
      <button className="rounded border px-4 py-2" disabled={pending || (action === "password-change" && hasPassword !== true) || (action === "password-reset/confirm" && !tokenValid)}>{pending ? t.pending : title}</button>
    </form>}
    {(action === "login" || action === "signup") && <div className="flex gap-4">{[["facebook", t.facebook], ["linkedin-openidconnect", t.linkedin]].map(([backend, name]) => <form key={backend} method="post" action={`/social-auth/login/${backend}/`}>
      <input type="hidden" name="csrfmiddlewaretoken" value={csrf} /><input type="hidden" name="next" value={next} />
      <button className="rounded border px-4 py-2" disabled={!csrf || pending}>{name}</button>
    </form>)}</div>}
    <div className="flex flex-wrap gap-4">
      {action !== "password-change" && <><a className="underline" href={`/${locale}/login/?${new URLSearchParams({ next })}`}>{t.login}</a>
      <a className="underline" href={`/${locale}/signup/?${new URLSearchParams({ next })}`}>{t.signup}</a></>}
      <a className="underline" href={`/${locale}/password-reset/?${new URLSearchParams({ next })}`}>{t.reset}</a>
    </div>
  </main>;
}
