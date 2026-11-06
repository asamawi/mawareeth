"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchCase, startCase, type Case } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { pendingView, runAction, type Action, type Deps, type View } from "@/interview/flow";

const SEEN_KEY = "mawareeth.case-seen";

// A remembered flag is the only way to tell "expired" from "never started". It is a
// convenience: when storage is blocked the page simply offers a new case.
const deps: Deps = {
  fetchCase: (signal) => fetchCase(signal),
  startCase: (signal, options) => startCase(signal, options),
  seen: {
    get() {
      try {
        return localStorage.getItem(SEEN_KEY) === "1";
      } catch {
        return false;
      }
    },
    set(value) {
      try {
        if (value) localStorage.setItem(SEEN_KEY, "1");
        else localStorage.removeItem(SEEN_KEY);
      } catch {}
    },
  },
};

const buttonClass =
  "rounded-md border border-current px-4 py-2 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:opacity-60";

function caseOf(view: View): Case | null {
  if (view.name === "existing" || view.name === "started") return view.case;
  if (view.name === "throttled" || view.name === "failed") return view.resumable;
  return null;
}

export function StartCase({ messages }: { messages: Messages["interview"] }) {
  const [view, setView] = useState<View>({ name: "loading" });
  const controller = useRef<AbortController | null>(null);
  const live = useRef(true);
  const latest = useRef<View>(view);
  const target = useRef<HTMLDivElement>(null);
  const settledOnce = useRef(false);

  // Every click makes exactly one attempt; a failure offers a retry and never retries by itself.
  const perform = useCallback(async (action: Action) => {
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;
    const existing = caseOf(latest.current);
    setView(pendingView(action));
    const next = await runAction(action, own.signal, deps, existing);
    if (live.current && controller.current === own) setView(next);
  }, []);

  useEffect(() => {
    live.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void perform("load");
    return () => {
      live.current = false;
      controller.current?.abort();
    };
  }, [perform]);

  useEffect(() => {
    latest.current = view;
    if (view.name === "loading" || view.name === "starting") return;
    // Land on the new view for keyboard and screen-reader users; the first view of a page
    // load keeps the focus where the browser put it.
    if (settledOnce.current) target.current?.focus();
    settledOnce.current = true;
  }, [view]);

  const resumable = view.name === "throttled" || view.name === "failed" ? view.resumable : null;

  return (
    <div data-js-only ref={target} tabIndex={-1} className="flex flex-col gap-4 outline-none">
      {view.name === "loading" && <p role="status">{messages.loading}</p>}
      {view.name === "starting" && <p role="status">{messages.starting}</p>}

      {view.name === "none" && (
        <>
          {view.expired && <p role="status">{messages.expired}</p>}
          <p>{messages.intro}</p>
          <div>
            <button type="button" className={buttonClass} onClick={() => void perform("start")}>
              {messages.start}
            </button>
          </div>
        </>
      )}

      {view.name === "existing" && (
        <>
          <p role="status">{messages.existing}</p>
          <p>
            {messages.caseRef}: <bdi dir="ltr">{view.case.id.slice(0, 8)}</bdi>
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={() => void perform("resume")}>
              {messages.resume}
            </button>
            <button type="button" className={buttonClass} onClick={() => void perform("startOver")}>
              {messages.startOver}
            </button>
          </div>
        </>
      )}

      {view.name === "started" && (
        <>
          <h2 className="text-xl font-semibold">
            {view.resumed ? messages.resumed : messages.started}
          </h2>
          {/* The only notice of where the case is kept and for how long. */}
          {!view.resumed && <p>{messages.intro}</p>}
          <p>
            {messages.caseRef}: <bdi dir="ltr">{view.case.id.slice(0, 8)}</bdi>
          </p>
          <p>{messages.placeholder}</p>
        </>
      )}

      {view.name === "throttled" && (
        <>
          <p role="alert">{messages.throttled}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={() => void perform("load")}>
              {messages.recheck}
            </button>
            {resumable && (
              <button type="button" className={buttonClass} onClick={() => void perform("resume")}>
                {messages.resume}
              </button>
            )}
          </div>
        </>
      )}

      {view.name === "failed" && (
        <>
          <p role="alert">{messages.failed}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={() => void perform(view.retry)}>
              {messages.retry}
            </button>
            {resumable && (
              <button type="button" className={buttonClass} onClick={() => void perform("resume")}>
                {messages.resume}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
