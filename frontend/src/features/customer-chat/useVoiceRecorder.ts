"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type RecorderState = "idle" | "recording" | "working";

/** Longest single recording. Someone will put the phone in their pocket. */
const MAX_SECONDS = 60;

/** Under ~1 KB is a stray tap, not speech. */
const MIN_BYTES = 1024;

/** Pick a container format this browser can actually produce. */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** Support cannot change while the page is open, so there is nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

function detectSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    pickMimeType() !== null
  );
}

interface UseVoiceRecorder {
  /** Called with the finished recording. */
  onRecorded: (audio: Blob) => Promise<void>;
  onError: (message: string) => void;
}

export function useVoiceRecorder({ onRecorded, onError }: UseVoiceRecorder) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);

  /**
   * Whether this browser can record at all.
   *
   * navigator and MediaRecorder do not exist during server rendering, and
   * navigator.mediaDevices is undefined outside a secure context (HTTPS or
   * localhost) — which is exactly the "opened over a LAN IP on a phone" case.
   *
   * useSyncExternalStore is the React 19 way to read a value that lives outside
   * React: it takes a client snapshot and a separate server snapshot, so there
   * is no setState-in-an-effect and no hydration mismatch.
   */
  const supported = useSyncExternalStore(subscribeNever, detectSupport, () => false);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const stream = useRef<MediaStream | null>(null);

  const releaseMic = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  // Always release the microphone when the component goes away.
  useEffect(() => releaseMic, [releaseMic]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  // Timer, plus a hard stop at MAX_SECONDS.
  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => {
      setSeconds((value) => {
        if (value + 1 >= MAX_SECONDS) stop();
        return value + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [state, stop]);

  const start = useCallback(async () => {
    if (state !== "idle") return;

    const mimeType = pickMimeType();
    if (!mimeType) {
      onError("Voice messages are not supported in this browser.");
      return;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      chunks.current = [];

      const instance = new MediaRecorder(media, { mimeType });

      instance.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };

      instance.onstop = async () => {
        releaseMic();
        const blob = new Blob(chunks.current, { type: mimeType });
        chunks.current = [];
        setSeconds(0);

        if (blob.size < MIN_BYTES) {
          setState("idle");
          onError("That was too short — hold the button while you speak.");
          return;
        }

        setState("working");
        try {
          await onRecorded(blob);
        } finally {
          setState("idle");
        }
      };

      instance.start();
      recorder.current = instance;
      setSeconds(0);
      setState("recording");
    } catch (cause) {
      releaseMic();
      setState("idle");
      const name = (cause as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        onError("Microphone access was blocked. Allow it in your browser settings.");
      } else if (name === "NotFoundError") {
        onError("No microphone found on this device.");
      } else {
        onError("Could not start recording.");
      }
    }
  }, [state, onError, onRecorded, releaseMic]);

  return { state, seconds, supported, start, stop };
}
