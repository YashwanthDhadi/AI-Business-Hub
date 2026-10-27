"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastMessage {
  id: number;
  message: string;
  tone: "success" | "info" | "error";
}

/** Minimal local toast state for simulated actions (no global provider needed). */
export function useToast(durationMs = 2800) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string, tone: ToastMessage["tone"] = "success") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), message, tone });
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs]
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, showToast, dismissToast: () => setToast(null) };
}
