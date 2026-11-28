export type AuthState = "loading" | "anonymous" | "authenticated" | "error";
export type Action = "save" | "share" | "whatsapp";
export function decide(auth: AuthState): "dialog" | "notice" {
  return auth === "authenticated" ? "notice" : "dialog";
}
export function parseResume(search: string): { action: Action | null; search: string } {
  const params = new URLSearchParams(search);
  const value = params.get("resume");
  params.delete("resume");
  const rest = params.toString();
  return { action: value === "save" || value === "share" || value === "whatsapp" ? value : null, search: rest ? `?${rest}` : "" };
}

export function authorizedAction(auth: AuthState, action: Action): "dialog" | Action {
  return auth === "authenticated" ? action : "dialog";
}

let sequence = 0;
/** A page-wide event order: the status line shows the event with the highest number. */
export function nextSeq(): number {
  sequence += 1;
  return sequence;
}

/** The message of the newest event; an empty message is an event too and blanks the line. */
export function newestLine(events: ({ text: string | null; seq: number } | null | undefined)[]): string {
  let best: { text: string | null; seq: number } | null = null;
  for (const event of events) if (event && typeof event.text === "string" && (best === null || event.seq > best.seq)) best = event;
  return best?.text ?? "";
}
