"use client";

import { useEffect } from "react";
import { getOrCreateSessionId } from "@/lib/session";

/** Ensure anonymous session id exists before any API calls. */
export function SessionBootstrap() {
  useEffect(() => {
    getOrCreateSessionId();
  }, []);

  return null;
}