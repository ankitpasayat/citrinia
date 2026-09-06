"use client";

import { useEffect } from "react";

// Registers the service worker app/sw.ts, served by app/serwist/[path]/route.ts.
// Production only: in development the route serves a network-only stub. The
// catch matters: Playwright blocks workers (playwright.config.ts), and a
// rejected register() would otherwise be a page error that fails a test.
export function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/serwist/sw.js", { type: "module", scope: "/" }).catch(() => {});
  }, []);
  return null;
}
