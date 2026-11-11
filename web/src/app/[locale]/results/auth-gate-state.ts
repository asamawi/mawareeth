export type AuthState = "loading" | "anonymous" | "authenticated" | "error";
export type Action = "save" | "share";
export function decide(auth: AuthState): "dialog" | "notice" {
  return auth === "authenticated" ? "notice" : "dialog";
}
export function parseResume(search: string): { action: Action | null; search: string } {
  const params = new URLSearchParams(search);
  const value = params.get("resume");
  params.delete("resume");
  const rest = params.toString();
  return { action: value === "save" || value === "share" ? value : null, search: rest ? `?${rest}` : "" };
}
