"use client";

import { useEffect, useState } from "react";

import { downloadSharedReport, viewShare, type SharedView as View } from "@/api/shares";
import type { Messages } from "@/i18n/messages";
import { loginHref, sharedPath, signupHref } from "@/i18n/paths";

import { buttonClass } from "../interview/form-bits";
import { Available } from "../results/results-view";

const STORAGE_KEY = "mawareeth.share-token";

type State = { kind: "loading" } | { kind: "sign_in" | "unavailable" | "throttled" | "failed" } | { kind: "view"; view: View };

/** Moves the token out of the URL fragment into sessionStorage, then drops the fragment. */
function takeToken(): string | null {
  const fragment = window.location.hash.replace(/^#/, "");
  if (fragment) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, fragment);
    } catch {
      // Private mode: the token still works for this load.
    }
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    return fragment;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function forgetToken() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to remove.
  }
}

/** A shared case, read-only. It never touches the visitor's own case. */
export function SharedView({ messages, locale }: { messages: Messages; locale: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; state: State; token: string | null } | null>(null);
  const text = messages.shared;

  useEffect(() => {
    const own = new AbortController();
    void (async () => {
      const token = takeToken();
      const result = token ? await viewShare(own.signal, token, locale) : ({ kind: "unavailable" } as const);
      if (result.kind === "unavailable") forgetToken();
      if (!own.signal.aborted) setLoaded({ attempt, token, state: result.kind === "view" ? { kind: "view", view: result.view } : { kind: result.kind } });
    })();
    return () => own.abort();
  }, [attempt, locale]);

  const current = loaded && loaded.attempt === attempt ? loaded : null;
  if (current === null) return <p role="status" className="mx-auto w-full max-w-xl">{text.loading}</p>;
  const { state, token } = current;
  const shell = "mx-auto flex w-full max-w-xl flex-col gap-3";

  if (state.kind === "sign_in") {
    const path = sharedPath(locale);
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
      <p><strong>{view.visibility === "public" ? text.publicBadge : text.privateBadge}</strong></p>
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
        download={(signal) => (token ? downloadSharedReport(token, locale, { signal }) : Promise.resolve({ kind: "gone" as const }))}
      />
    </>
  );
}
