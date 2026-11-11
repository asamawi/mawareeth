"use client";

import { useEffect, useState } from "react";
import { fetchSession } from "@/api/session";
import type { AuthState } from "./results/auth-gate-state";

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>("loading");
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      setState("error");
    }, 10_000);
    fetchSession(controller.signal).then(
      (session) => { if (!controller.signal.aborted) setState(session.authenticated ? "authenticated" : "anonymous"); },
      () => { if (!controller.signal.aborted) setState("error"); },
    ).finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return state;
}
