"use client";

import { useEffect, useState } from "react";

import { downloadReceivedReport, viewReceived, type ReceivedView as View } from "@/api/invites";
import type { Messages } from "@/i18n/messages";
import { loginHref, receivedPath, signupHref } from "@/i18n/paths";

import { buttonClass } from "../interview/form-bits";
import { Available } from "../results/results-view";

type State = { kind: "loading" } | { kind: "sign_in" | "unavailable" | "throttled" | "failed" } | { kind: "view"; view: View };
function takeId(): number | null {
  const fragment = window.location.hash.slice(1);
  const id = /^\d+$/.test(fragment) ? Number(fragment) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A shared case, read-only. It never touches the visitor's own case. */
export function ReceivedView({ messages, locale }: { messages: Messages; locale: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; state: State; id: number | null } | null>(null);
  const text = messages.shared;

  useEffect(() => {
    const reload = () => setAttempt((count) => count + 1);
    window.addEventListener("hashchange", reload);
    return () => window.removeEventListener("hashchange", reload);
  }, []);

  useEffect(() => {
    const own = new AbortController();
    void (async () => {
      const id = takeId();
      const result = id ? await viewReceived(own.signal, id, locale) : ({ kind: "unavailable" } as const);
      if (!own.signal.aborted) setLoaded({ attempt, id, state: result.kind === "view" ? { kind: "view", view: result.view } : { kind: result.kind } });
    })();
    return () => own.abort();
  }, [attempt, locale]);

  const current = loaded && loaded.attempt === attempt ? loaded : null;
  if (current === null) return <p role="status" className="mx-auto w-full max-w-xl">{text.loading}</p>;
  const { state, id } = current;
  const shell = "mx-auto flex w-full max-w-xl flex-col gap-3";

  if (state.kind === "sign_in") {
    const path = receivedPath(locale, id ?? 0);
    return (
      <div className={shell}>
        <p role="status">{text.signInTitle}</p>
        <a className={buttonClass} href={loginHref(path)}>{text.signIn}</a>
        <a className={buttonClass} href={signupHref(locale, path)}>{text.createAccount}</a>
      </div>
    );
  }
  if (state.kind === "unavailable") return <p role="alert" className={shell}>{text.unavailable}</p>;
  if (state.kind === "throttled" || state.kind === "failed") {
    return (
      <div className={shell}>
        <p role="alert">{state.kind === "throttled" ? text.throttled : text.error}</p>
        <div><button type="button" className={buttonClass} onClick={() => setAttempt((count) => count + 1)}>{text.retry}</button></div>
      </div>
    );
  }
  if (state.kind !== "view") return null;
  const { view } = state;
  const banner = (
    <div className={shell}>
      <p role="note" className="rounded-md border border-current/60 p-3 font-semibold">{text.banner}</p>
      <p><strong>{messages.invites.owner}: {view.owner}</strong></p>
    </div>
  );
  if (view.preview.status !== "available") {
    return <>{banner}<p role="alert" className={shell}>{text.error}</p></>;
  }
  return (
    <>
      {banner}
      <Available
        key={view.kase.id}
        messages={messages}
        locale={locale}
        kase={view.kase}
        preview={view.preview}
        back={null}
        gate={false}
        download={(signal) => (id ? downloadReceivedReport(id, locale, { signal }) : Promise.resolve({ kind: "gone" as const }))}
      />
    </>
  );
}
