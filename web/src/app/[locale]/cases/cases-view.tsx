"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { listSavedCases, openSavedCase, type SavedCase } from "@/api/saved-cases";
import type { Messages } from "@/i18n/messages";
import { listReceived, type Received } from "@/api/invites";
import { casesPath, loginHref, receivedPath } from "@/i18n/paths";
import { useAuthState } from "../use-session";
import { buttonClass } from "../interview/form-bits";
export function CasesView({ locale, text }: { locale: string; text: Messages }) {
  const router = useRouter();
  const auth = useAuthState();
  const [rows, setRows] = useState<SavedCase[] | null>(null);
  const [received, setReceived] = useState<Received[] | null>(null);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  useEffect(() => {
    if (auth !== "authenticated") return;
    const controller = new AbortController();
    listReceived(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setReceived(value); },
      () => { if (!controller.signal.aborted) setError(true); },
    );
    listSavedCases(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setRows(value); },
      () => { if (!controller.signal.aborted) setError(true); },
    );
    return () => controller.abort();
  }, [auth]);
  async function open(id: number) {
    setOpening(id);
    setError(false);
    const result = await openSavedCase(new AbortController().signal, id);
    if (result) router.push(`/${locale}/interview/`);
    else { setError(true); setOpening(null); }
  }
  if (auth === "loading") return <p role="status">{text.checking}</p>;
  if (auth !== "authenticated") return (
    <p>
      {auth === "error" && <span role="alert">{text.unavailable} </span>}
      <a className={buttonClass} href={loginHref(casesPath(locale))}>{text.cases.signIn}</a>
    </p>
  );
  return (
    <>
      <p role="alert">{error ? text.cases.error : ""}</p>
      {!rows && !error && <p role="status">{text.checking}</p>}
      {rows?.length === 0 && <p>{text.cases.empty}</p>}
      <ul className="flex flex-col gap-4">
        {rows?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-4 rounded border p-4">
            <span id={`saved-${row.id}`}>{text.cases.updated}: {new Date(row.updated_at).toLocaleString(locale)}</span>
            <span>{text.interview.madhabs[row.madhab].name}</span>
            <span>{text.cases.heirs}: {row.heir_count}</span>
            <span>{row.status === "draft" ? text.cases.draft : row.status}</span>
            {/* Every row has an Open button; the date tells screen-reader users which case it opens. */}
            <button type="button" aria-describedby={`saved-${row.id}`} className={buttonClass} disabled={opening !== null} onClick={() => void open(row.id)}>
              {text.cases.open}
            </button>
          </li>
        ))}
      </ul>
      <h2 className="text-xl font-semibold">{text.invites.received}</h2>
      {received?.length === 0 && <p>{text.invites.empty}</p>}
      <ul className="flex flex-col gap-4">{received?.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-4 rounded border p-4">
        <span>{text.invites.owner}: <bdi>{row.owner}</bdi></span>
        <span>{text.cases.updated}: {new Date(row.updated_at).toLocaleString(locale)}</span>
        <span>{text.invites.expires}: {new Date(row.expires_at).toLocaleDateString(locale)}</span>
        <span>{text.cases.draft}</span><a href={receivedPath(locale, row.id)} className={buttonClass}>{text.invites.open}</a>
      </li>)}</ul>
    </>
  );
}
