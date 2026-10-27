# Part 6 — Voice input (STEP 21 → STEP 22)

The customer holds a button, speaks, releases, and the agent answers. Two steps:
the backend that turns audio into text, then the microphone button in the chat
window.

This works entirely in the browser with no app, no plugin and no extra account.

Note this is the **only** part of the project that still uses Groq. Chat moved to
OpenRouter in Part 3; Groq stays here because its Whisper endpoint is free, fast
and ungated. If you skipped the Groq key in STEP 2, get one now:
<https://console.groq.com> - API Keys - Create API Key, and put it in
`GROQ_API_KEY`.

---

## STEP 21 — Speech to text

### Goal

An endpoint that accepts an uploaded audio recording, transcribes it, and runs
the result through the same agent as a typed message.

### Why?

Typing is a barrier. A gym member walking to their car, someone whose first
language is not English, an older customer who finds phone keyboards fiddly — all
of them would rather talk. Voice input is not a novelty here; it is the thing
that makes the chat usable for people who would otherwise give up.

The design keeps it simple: audio becomes text, and from that moment on it is
**exactly** a normal message. Same agent, same tools, same rate limits, same
storage. The only difference is one flag in the message's metadata, so the owner
can see the customer spoke rather than typed.

### Architecture

```
Browser
   │  MediaRecorder produces a Blob (webm on Chrome, mp4 on Safari)
   ▼  POST /api/v1/chat/voice   multipart/form-data, field "file"
FastAPI
   ├─ resolve session, check the voice rate limit, check the size
   ▼
Groq  POST /openai/v1/audio/transcriptions   model=whisper-large-v3-turbo
   │
   ▼  {"text": "do you have a three month membership?"}
FastAPI
   ├─ hand the text to the SAME agent as a typed message
   ▼
   {"transcript": "...", "reply": "...", "handed_over": false}
```

### Files involved

```
backend/app/
├── channels/
│   ├── __init__.py       ← create (empty)
│   └── speech.py         ← create
├── services/chat.py      ← edit (one function)
└── routers/chat.py       ← edit (one route)
```

### Code

**`backend/app/channels/__init__.py`** — empty:

```python
```

**`backend/app/channels/speech.py`**:

```python
"""
Speech to text, via Groq's hosted Whisper.

One multipart POST. No SDK, because there is nothing an SDK would add.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger("aibh.speech")

TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
TIMEOUT = 45

# Groq accepts these container formats. The KEY is the browser's MIME type,
# the VALUE is the filename extension Groq expects — it reads the extension,
# so sending "blob" with no extension is rejected.
SUPPORTED_TYPES = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mpga": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
}


@dataclass
class Transcript:
    ok: bool
    text: str = ""
    error: str | None = None


def _extension_for(content_type: str | None) -> str | None:
    """Map a browser MIME type to a file extension Groq understands."""
    if not content_type:
        return None
    # Browsers send 'audio/webm;codecs=opus' — strip the parameters.
    base = content_type.split(";")[0].strip().lower()
    return SUPPORTED_TYPES.get(base)


def transcribe(audio: bytes, content_type: str | None, language: str | None = None) -> Transcript:
    """
    Turn recorded audio into text.

    Never raises: a failed transcription is an ordinary outcome the customer
    should be told about politely, not a 500.
    """
    if not settings.groq_api_key:
        return Transcript(ok=False, error="Speech recognition is not configured.")

    if not audio:
        return Transcript(ok=False, error="The recording was empty.")

    if len(audio) > settings.voice_max_upload_bytes:
        return Transcript(
            ok=False,
            error=f"That recording is too long. Please keep it under "
            f"{settings.voice_max_upload_mb} MB.",
        )

    extension = _extension_for(content_type)
    if extension is None:
        logger.warning("Unsupported audio type: %s", content_type)
        return Transcript(ok=False, error="That audio format is not supported.")

    data = {"model": settings.groq_stt_model, "response_format": "json"}
    if language:
        data["language"] = language

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                files={"file": (f"recording.{extension}", audio, content_type)},
                data=data,
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Transcription request failed")
        return Transcript(ok=False, error=f"Could not reach the transcription service: {exc}")

    if response.status_code >= 300:
        detail = ""
        try:
            detail = (response.json().get("error") or {}).get("message", "")
        except Exception:  # noqa: BLE001
            detail = response.text[:200]
        logger.error("Groq transcription failed: %s %s", response.status_code, detail)
        return Transcript(ok=False, error=detail or "Transcription failed.")

    try:
        text = (response.json().get("text") or "").strip()
    except Exception:  # noqa: BLE001
        return Transcript(ok=False, error="Transcription returned an unreadable response.")

    if not text:
        return Transcript(ok=False, error="I couldn't hear anything. Please try again.")

    logger.info("Transcribed %s bytes -> %r", len(audio), text[:80])
    return Transcript(ok=True, text=text)
```

**`backend/app/services/chat.py`** — add this function at the bottom:

```python
def handle_voice(
    resolved: ResolvedSession,
    audio: bytes,
    content_type: str | None,
) -> dict:
    """
    Transcribe a recording, then treat it exactly like a typed message.

    Returns the transcript as well as the reply, so the chat window can show
    the customer what was heard.
    """
    from app.channels.speech import transcribe

    result = transcribe(audio, content_type)
    if not result.ok:
        raise ChatError(result.error or "Could not understand that recording.", 400)

    text = validate_message(result.text)
    outcome = handle_message(resolved, text, from_voice=True)
    return {"transcript": text, **outcome}
```

**`backend/app/routers/chat.py`** — add this import at the top:

```python
from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile
```

and this route at the bottom:

```python
@router.post("/voice")
async def send_voice(
    request: Request,
    file: UploadFile = File(...),
    x_chat_session: str | None = Header(default=None),
) -> dict:
    """Upload a recording; get back what we heard and the agent's reply."""
    try:
        resolved = chat_service.resolve_session(x_chat_session or "")
        chat_service.check_limits(resolved, client_ip(request), voice=True)
        audio = await file.read()
        return chat_service.handle_voice(resolved, audio, file.content_type)
    except chat_service.ChatError as error:
        raise _fail(error) from error
```

### Explain the code

```python
SUPPORTED_TYPES = {"audio/webm": "webm", "audio/mp4": "mp4", ...}
```
The map that makes this work across browsers. Chrome's MediaRecorder produces
`audio/webm`; Safari produces `audio/mp4`. Both are fine for Whisper — but Groq
identifies the format from the **filename extension**, so uploading a blob called
`blob` with no extension gets rejected regardless of the MIME type. Hence the
lookup, and hence `recording.{extension}` below.

```python
base = content_type.split(";")[0].strip().lower()
```
Browsers send `audio/webm;codecs=opus`, not a bare `audio/webm`. Looking up the
full string finds nothing. This is the kind of thing that costs an afternoon.

```python
files={"file": (f"recording.{extension}", audio, content_type)}, data=data
```
`httpx` builds a `multipart/form-data` body from the `files` and `data`
arguments. The tuple is `(filename, content, content_type)` — all three matter.
Note `data` carries the model name as a form field, not JSON: this endpoint is
form-encoded, unlike every other Groq call.

```python
if len(audio) > settings.voice_max_upload_bytes:
```
Checked in your code before the upload goes anywhere. Without it, a crafted
200 MB POST is sent to Groq on your key and your quota.

FastAPI also streams uploads to a temporary file rather than holding them in
memory, so `await file.read()` on a large upload is a disk write, not an
out-of-memory crash — but it is still work you do not want to do for a request
you will reject.

```python
return Transcript(ok=False, error="I couldn't hear anything. Please try again.")
```
Whisper returns an empty string for silence — which happens constantly when
someone taps the button by accident or the microphone is muted. Treating that as
a friendly message rather than a failure is the difference between "try again"
and "something went wrong".

```python
text = validate_message(result.text)
outcome = handle_message(resolved, text, from_voice=True)
```
The join point. After transcription, voice and text are the same code path — same
agent, same tools, same storage, same escalation. `from_voice=True` only sets
`meta.source`, so the owner's dashboard can show a small microphone icon.

That reuse is the whole design. There is no "voice agent" to keep in sync with
the text one, because there is only one agent.

```python
chat_service.check_limits(resolved, client_ip(request), voice=True)
```
The tighter voice limit, checked **before** reading the file. A transcription is
several times more expensive than a chat message: an upload, a Whisper call, then
the agent.

```python
file: UploadFile = File(...)
```
FastAPI's file upload type. This is what needs `python-multipart` from STEP 5.
`File(...)` with an ellipsis means required.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
New-Item -ItemType Directory -Force backend\app\channels
New-Item -ItemType File -Force backend\app\channels\__init__.py
```

Create `speech.py`, then edit `chat.py` and `routers/chat.py`.

### How to test

You need an audio file. Record one on your phone, or make one with Windows
Sound Recorder (it saves `.m4a`, which works). Say something the agent can
answer, like *"can I freeze my membership?"*

First test transcription on its own, with no session involved. Create
`backend/scripts/check_speech.py`:

```python
"""Transcribe a local audio file. Run from backend/:
       python scripts\\check_speech.py C:\\path\\to\\recording.m4a
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import mimetypes

from app.channels.speech import transcribe

path = Path(sys.argv[1])
audio = path.read_bytes()
content_type = mimetypes.guess_type(path.name)[0] or "audio/mp4"

print(f"file        : {path.name} ({len(audio)} bytes)")
print(f"content type: {content_type}")

result = transcribe(audio, content_type)
print(f"ok          : {result.ok}")
print(f"text        : {result.text}")
print(f"error       : {result.error}")
```

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\backend"
python scripts\check_speech.py "C:\Users\Akshaya Reddy\Downloads\recording.m4a"
```

Then the full endpoint. Start a session (as in STEP 17), then:

```powershell
$t = "PASTE_A_SESSION_TOKEN"
curl.exe -s -X POST http://127.0.0.1:8000/api/v1/chat/voice `
  -H "X-Chat-Session: $t" `
  -F "file=@C:\Users\Akshaya Reddy\Downloads\recording.m4a"
```

### Expected result

The script:

```
file        : recording.m4a (48213 bytes)
content type: audio/mp4
ok          : True
text        : Can I freeze my membership?
error       : None
```

The endpoint:

```json
{
  "transcript": "Can I freeze my membership?",
  "reply": "Yes — quarterly and annual members can freeze for up to 30 days a year...",
  "handed_over": false,
  "notice": null,
  "latency_ms": 710
}
```

In Supabase, the `messages` row for the customer's turn has
`meta -> source = "voice"`.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `That audio format is not supported` | MIME type not in the map, or missing | Print `file.content_type` in the route and add it to `SUPPORTED_TYPES`. |
| Groq: `invalid_request_error ... file format` | The filename had no extension | Keep `recording.{extension}`. |
| `model_decommissioned` | Groq retired the Whisper model | Check <https://console.groq.com/docs/speech-to-text>, update `GROQ_STT_MODEL`. |
| `I couldn't hear anything` | Silence, muted microphone, or a very short clip | Record at least two seconds of speech. |
| `Form data requires "python-multipart"` | Package missing | `python -m pip install python-multipart`, restart. |
| `413` from the endpoint | Recording over the limit | Raise `VOICE_MAX_UPLOAD_MB`, or shorten the clip. |
| Transcript is nonsense | Wrong language guess | Pass `language="hi"` (or `"te"`, `"en"`) to `transcribe`. Turbo auto-detects, but a hint helps in noise. |

---

## STEP 22 — Make the microphone real

### Goal

Replace the simulated voice input in the chat with a real recording that gets
transcribed by Whisper and answered by the agent.

### Why?

The chat already has a microphone button and a rather nice "listening" overlay
with an animated waveform. But it is theatre: `startVoice()` picks a phrase from
a hardcoded list and types it out letter by letter.

We keep all of that UI and replace only the brain — the same trick as STEP 20.
The customer sees the same overlay; the difference is that it now records them.

### What changes

| Piece | Fate |
| --- | --- |
| The mic button, the overlay, the waveform, Cancel | **Kept, untouched** |
| `VOICE_SAMPLES` and the fake transcript typing | **Gone** |
| `startVoice` / `cancelVoice` | **Rewritten** around `MediaRecorder` |
| `chatApi.sendVoice` | Already written in STEP 18 — nothing to add |

### Browser reality, up front

`MediaRecorder` is widely supported, with three caveats you must code around:

- **Chrome and Firefox record `audio/webm`. Safari records `audio/mp4`.** You
  cannot hardcode either — we feature-detect.
- **It only works in a secure context** — HTTPS, or `localhost`. Opening the
  page over a LAN IP (`http://192.168.1.5:3000`) on a phone will **not** get a
  microphone. That is a browser rule, not a bug in your code.
- **iOS needs a real user gesture.** Starting a recording from anything other
  than a direct tap is blocked.

### Architecture

```
tap mic ──► getUserMedia({audio:true}) ──► browser permission prompt
                     │
            overlay opens, MediaRecorder collects chunks
                     │
tap stop ──► Blob ──► POST /api/v1/chat/voice
                          │
              transcript appears as the customer's message
                          │
                     agent replies
```

### Files involved

```
frontend/src/features/customer-chat/
├── useVoiceRecorder.ts                     ← create
└── components/CustomerChatApp.tsx          ← edit (four small changes)
```

### Code

**`frontend/src/features/customer-chat/useVoiceRecorder.ts`**:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

interface UseVoiceRecorder {
  /** Called with the finished recording. Throw to surface an error. */
  onRecorded: (audio: Blob) => Promise<void>;
  onError: (message: string) => void;
}

export function useVoiceRecorder({ onRecorded, onError }: UseVoiceRecorder) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const stream = useRef<MediaStream | null>(null);

  // navigator/MediaRecorder do not exist on the server, so check in an effect.
  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        pickMimeType() !== null,
    );
  }, []);

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
```

**`frontend/src/features/customer-chat/components/CustomerChatApp.tsx`** — four
changes.

**1.** Add to the imports:

```tsx
import { useVoiceRecorder } from "../useVoiceRecorder";
```

**2.** Add this callback just after the `send` function:

```tsx
  const sendRecording = useCallback(
    async (audio: Blob) => {
      if (!token.current) return;
      setError(null);
      setTyping(true);

      try {
        const result = await chatApi.sendVoice(token.current, audio);

        // Show what we heard as the customer's own message.
        setMessages((prev) => [
          ...prev,
          { id: nextId(), sender: "customer", text: result.transcript, timestamp: nowLabel() },
        ]);

        if (result.reply) appendAgent(result.reply);
        if (result.notice) appendAgent(result.notice, "system");
        if (result.handed_over) setHandedOver(true);
      } catch (cause) {
        if (cause instanceof ChatApiError) {
          setError(cause.message);
          if (cause.retryAfter > 0) setCooldown(cause.retryAfter);
        } else {
          setError("Could not send that recording.");
        }
      } finally {
        setTyping(false);
      }
    },
    [],
  );

  const recorder = useVoiceRecorder({
    onRecorded: sendRecording,
    onError: (message) => setError(message),
  });
```

**3.** Delete the simulated voice block — these five lines:

```tsx
  /* ---------------------------------------------------------------- voice */
  // Part 6 replaces this simulation with a real microphone.

  const startVoice = () => setVoice({ state: "listening", transcript: "" });
  const cancelVoice = () => setVoice({ state: "idle", transcript: "" });
```

…and the now-unused state above it:

```tsx
  const [voice, setVoice] = useState<{ state: "idle" | "listening"; transcript: string }>({ state: "idle", transcript: "" });
```

**4.** Replace the microphone button and the overlay.

The button becomes:

```tsx
          {assistant.voiceInputEnabled && recorder.supported && (
            <button
              type="button"
              onClick={() => (recorder.state === "recording" ? recorder.stop() : void recorder.start())}
              disabled={typing || cooldown > 0 || booting || chatOff || recorder.state === "working"}
              aria-label={recorder.state === "recording" ? "Stop recording" : "Record a voice message"}
              aria-pressed={recorder.state === "recording"}
              className={cn(
                "h-11 rounded-full flex items-center justify-center flex-shrink-0 gap-1.5 transition-colors cursor-pointer disabled:opacity-50",
                recorder.state === "recording"
                  ? "bg-rose-600 text-white px-3"
                  : "w-11 bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700",
              )}
            >
              {recorder.state === "working" ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
              {recorder.state === "recording" && (
                <span className="text-xs font-medium tabular-nums">
                  {String(Math.floor(recorder.seconds / 60)).padStart(2, "0")}:
                  {String(recorder.seconds % 60).padStart(2, "0")}
                </span>
              )}
            </button>
          )}
```

and the overlay at the bottom becomes:

```tsx
        {/* Listening overlay */}
        {recorder.state === "recording" && (
          <div
            className="absolute inset-x-0 bottom-0 z-10 bg-gray-950/95 backdrop-blur border-t border-gray-800 p-6 pb-10 flex flex-col items-center gap-4"
            role="dialog"
            aria-label="Listening"
          >
            <div className="flex items-end gap-1 h-10" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-indigo-500 animate-pulse"
                  style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${i * 90}ms` }}
                />
              ))}
            </div>
            <p className="text-sm text-white text-center">Listening… speak now</p>
            <p className="text-[11px] text-gray-500 tabular-nums">
              {String(Math.floor(recorder.seconds / 60)).padStart(2, "0")}:
              {String(recorder.seconds % 60).padStart(2, "0")} · tap stop when you're done
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => recorder.stop()}
                className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" /> Done
              </button>
            </div>
          </div>
        )}
```

Finally, update the `lucide-react` import line to swap `X` for `Check`:

```tsx
import { Send, Mic, Check, CalendarPlus, LayoutGrid, BadgePercent, HelpCircle, Clock, MapPin, Phone, Sparkles, RefreshCw } from "lucide-react";
```

### Explain the code

```ts
const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
```
Feature detection instead of browser sniffing. Chrome takes the first, Safari
falls through to `audio/mp4`. Asking *"can you do this?"* rather than *"who are
you?"* means the code keeps working when browsers change.

```ts
setSupported(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && pickMimeType() !== null);
```
Run inside an effect, not during render, because `navigator` and `MediaRecorder`
do not exist on the server — touching them during render breaks server rendering
with `navigator is not defined`.

Note `navigator.mediaDevices` is **undefined** — not merely restricted — outside
a secure context. So this one check also catches the "opened over a LAN IP on a
phone" case automatically, and the button simply does not render.

```tsx
{assistant.voiceInputEnabled && recorder.supported && ( ... )}
```
Two gates: the owner allows voice, **and** this browser can do it. A microphone
icon that throws an error when tapped is worse than no icon at all.

```ts
instance.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
```
`MediaRecorder` hands you audio in pieces; you stitch them into one `Blob` when
recording stops. `useRef` rather than `useState` because these fire many times a
second and must not trigger re-renders.

```ts
releaseMic();   // stream.current?.getTracks().forEach(t => t.stop())
```
**Do not skip this.** If you never stop the tracks, the browser keeps the
microphone open and the recording indicator stays lit in the tab and in the
system status bar. Users notice, and they are right to be unnerved. It runs in
`onstop`, in the error path, and on unmount.

```ts
if (blob.size < MIN_BYTES) { onError("That was too short — hold the button while you speak."); }
```
Catches the accidental tap before it costs an upload and a Whisper call.

```ts
setSeconds((value) => { if (value + 1 >= MAX_SECONDS) stop(); return value + 1; });
```
A hard stop at one minute, driven from inside the timer so there is no second
effect watching `seconds`. Without it, a forgotten recording becomes a very long
upload.

```ts
if (name === "NotAllowedError" || name === "SecurityError") { ... }
else if (name === "NotFoundError") { ... }
```
`getUserMedia` rejects with a *named* error, and each name means something
different to the customer: a denied permission is something they can fix, a
missing microphone is not. Mapping them turns a dead end into an instruction.

```tsx
aria-pressed={recorder.state === "recording"}
```
Tells a screen reader this is a toggle and which state it is in. With
`aria-label`, it makes the button usable without sight.

```tsx
<span className="tabular-nums">
```
Makes all digits the same width so the timer does not jitter as it counts. A
one-class detail that makes the whole thing feel finished.

```tsx
setMessages((prev) => [...prev, { ..., sender: "customer", text: result.transcript }]);
```
Showing the transcript as the customer's own message is not decoration — it is
how they find out what the agent actually heard. Without it, a misheard word
produces a baffling answer with no explanation.

### Optionally: let the agent speak back

The browser can read replies aloud with no API and no cost. Add to
`CustomerChatApp`:

```tsx
  const [speak, setSpeak] = useState(false);

  const say = useCallback(
    (text: string) => {
      if (!speak || typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    },
    [speak],
  );
```

Call `say(result.reply)` wherever you append an agent turn, and put a toggle in
the header next to the phone link:

```tsx
<button
  type="button"
  onClick={() => setSpeak((value) => !value)}
  aria-label={speak ? "Turn off spoken replies" : "Read replies aloud"}
  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
>
  {speak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
</button>
```

(Import `Volume2` and `VolumeX` from `lucide-react`.)

`speechSynthesis` is built into every modern browser, works offline and costs
nothing. The voices are noticeably more robotic than a paid TTS service — for a
support chat that is an acceptable trade, and it keeps the feature free. Default
it to **off**: a page that starts talking unprompted is startling, and often
happens when someone is in a quiet room.

### Commands

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
```

Create `src/features/customer-chat/useVoiceRecorder.ts`, then make the four
edits to `CustomerChatApp.tsx`.

### How to test

Open <http://localhost:3000/chat/pulse-fitness> — **on `localhost`**, not a LAN
IP, or the microphone will not be offered.

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Look at the composer | A microphone button left of the text box |
| 2 | Tap it | Browser asks for microphone permission |
| 3 | Allow, then say "can I freeze my membership?" | Overlay opens, button turns red, timer counts |
| 4 | Tap **Done** | Spinner, then your words appear as your message |
| 5 | Wait | The agent answers the transcribed question |
| 6 | Tap and immediately stop | "That was too short" — no upload |
| 7 | Deny permission (reset it in site settings first) | A clear message about blocking |
| 8 | Record 9 clips quickly | The voice rate limit trips with a countdown |
| 9 | Check the browser tab | The recording indicator disappears after you stop |
| 10 | Try Safari, if you have a Mac or iPhone | Works, using `audio/mp4` |

### Expected result

You speak, and two or three seconds later the agent has answered — with the
transcript shown as your own message so you can see what it heard.

In Supabase, that customer message row has `meta -> source = "voice"`.

Test 9 is the one people skip: after stopping, the browser's recording dot must
go away. If it stays on, `releaseMic()` is not running.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| No microphone button | Not a secure context, or `MediaRecorder` missing | Use `localhost`, not a LAN IP. HTTPS in production. |
| Button appears, permission prompt never shows | Permission already denied for the site | Browser settings → Site settings → Microphone → reset. |
| `NotAllowedError` every time | Denied, or an OS-level block | Check Windows Settings → Privacy → Microphone. |
| Upload gets 422 | `Content-Type` set manually on the FormData request | `chatApi.sendVoice` deliberately omits it — do not add it. |
| "That audio format is not supported" | Browser produced a type the backend does not map | Log `file.content_type` in the route and add it to `SUPPORTED_TYPES`. |
| Recording indicator stays on | Tracks not stopped | `releaseMic()` must run in `onstop` **and** on unmount. |
| Transcript empty or wrong | Noise, distance, or language | Speak close to the mic. Pass `language=` to `transcribe`. |
| Works in Chrome, silent in Safari | Hardcoded `audio/webm` | Keep `pickMimeType()`. |
| `Cannot find name 'voice'` | Step 3 half-done | Remove **both** the `voice` state and the two helper functions. |
| Spoken replies talk over each other | No cancel before speaking | `window.speechSynthesis.cancel()` first, as shown. |

---

## End of Part 6 — checklist

- [ ] `python scripts\check_speech.py <file>` transcribes a real recording
- [ ] `POST /api/v1/chat/voice` returns a transcript and a reply
- [ ] The microphone button appears on `localhost`
- [ ] Recording opens the overlay and the timer counts
- [ ] The transcript appears as the customer's own message
- [ ] The agent answers the spoken question correctly
- [ ] A stray tap is rejected without an upload
- [ ] Denied permission gives a clear message
- [ ] The recording indicator turns off when you stop
- [ ] `meta -> source = "voice"` on the stored message

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth\frontend"
npx tsc --noEmit
npm run lint
cd ..
git add backend frontend docs
git commit -m "Add voice input: Whisper transcription and press-to-talk"
```

Next: [07-owner-dashboard.md](07-owner-dashboard.md) — the business owner's side.
