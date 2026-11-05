"use client";

import { useEffect, useState } from "react";

import { probeSession } from "@/api/session";
import type { Messages } from "@/i18n/messages";

type Status = "checking" | "connected" | "unavailable";

export function SessionStatus({ messages }: { messages: Messages }) {
  const [status, setStatus] = useState<Status>("checking");

  // One attempt per page load: a failure shows the message and does not retry.
  useEffect(() => {
    const controller = new AbortController();
    let unmounted = false;

    probeSession(controller.signal).then((result) => {
      if (!unmounted) setStatus(result);
    });

    return () => {
      unmounted = true;
      controller.abort();
    };
  }, []);

  return (
    <p role="status" data-status={status} className="text-lg">
      {messages[status]}
    </p>
  );
}
