"use client";

import { useEffect } from "react";

import { casesPath } from "@/i18n/paths";

import { useAuthState } from "./use-session";

/**
 * The landing page is always rendered in full, so crawlers and anonymous visitors
 * get the whole page. Only a visitor the session check proves signed in is sent on.
 */
export function LandingRedirect({ locale }: { locale: string }) {
  const auth = useAuthState();
  useEffect(() => {
    if (auth === "authenticated") window.location.replace(casesPath(locale));
  }, [auth, locale]);
  return null;
}
