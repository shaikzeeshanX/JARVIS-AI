"use client"

import * as React from "react"

/**
 * Voice layer — Web Speech API (free, built into the browser, no API cost).
 *
 *  - the reader: one active text, a cursor that tracks how far it has been
 *    read, and a mute switch that cuts audio without losing progress.
 *  - useSpeechRecognition(): speech-to-text for the microphone button.
 *
 * Works in Chrome, Edge and Safari. Firefox has no SpeechRecognition yet —
 * the mic button hides itself automatically.
 */

let voices: SpeechSynthesisVoice[] = []

function ensureVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve([])
      return
    }
    const load = () => {
      voices = window.speechSynthesis.getVoices()
      resolve(voices)
    }
    load()
    if (voices.length === 0) {
      window.speechSynthesis.onvoiceschanged = load
      // Some browsers never fire the event — bail after a moment.
      setTimeout(load, 800)
    }
  })
}

function pickVoice(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return (
    list.find((v) => /en[-_]/i.test(v.lang) && /Google|Microsoft|Natural|Online/i.test(v.name)) ??
    list.find((v) => /^en/i.test(v.lang)) ??
    list[0]
  )
}

// ── The reader ───────────────────────────────────────────────
//
// Exactly one text is "active" at a time. `cursor` is how many characters of it
// have been read — heard, or silently consumed while muted. New text replaces
// the old one immediately; muting only stops the audio, never the progress.

/** Steady, conversational pace — not rushed, not dragging. */
const SPEECH_RATE = 1.0
/** Rough characters-per-second at the rate above, used to advance while muted. */
const CHARS_PER_SEC = 15
/** Browsers truncate long utterances (Chrome ~15s), so read in mouthfuls. */
const CHUNK_MAX = 240

type SpeakingListener = (speaking: boolean) => void

const speakingListeners = new Set<SpeakingListener>()

/** Full, normalized text of the active reading session. */
let sessionText = ""
/** Characters of sessionText already read. */
let cursor = 0
let muted = false
/** A forced line (e.g. "Voice off.") may still be spoken while muted. */
let speakWhileMuted = false

type ActiveUtterance = {
  utter: SpeechSynthesisUtterance
  chunkStart: number
  chunkEnd: number
}

/** The audio currently playing, if any. At most one exists at a time. */
let active: ActiveUtterance | null = null
/** Session index the current audio started from, and when. */
let anchorCursor = 0
let anchorAt = 0
/** True while voices are loading, so two utterances can't start at once. */
let starting = false
/** Interval that advances the cursor while muted. */
let silentTimer: number | null = null
/** Bumped on every cancel so stale utterances can't touch the reader. */
let generation = 0
let speakingFlag = false

function speechAvailable() {
  return typeof window !== "undefined" && !!window.speechSynthesis
}

function notifySpeaking() {
  const next = active !== null
  if (next === speakingFlag) return
  speakingFlag = next
  for (const listener of speakingListeners) {
    try {
      listener(next)
    } catch {
      /* a broken subscriber must not stop the voice */
    }
  }
}

/** True while audio is actually playing (false while muted). */
export function isSpeaking() {
  return speakingFlag
}

/** Subscribe to speak start/stop. Returns an unsubscribe function. */
export function subscribeSpeaking(listener: SpeakingListener) {
  speakingListeners.add(listener)
  return () => {
    speakingListeners.delete(listener)
  }
}

/** Reactive `isSpeaking()` for components (drives the cube's zoom pulse). */
export function useSpeakingState(): boolean {
  const [speaking, setSpeaking] = React.useState(false)
  React.useEffect(() => {
    const off = subscribeSpeaking(setSpeaking)
    setSpeaking(isSpeaking())
    return off
  }, [])
  return speaking
}

/** True when the reader is silent. */
export function isMuted() {
  return muted
}

/**
 * How far the active text has been read. `cursor` advances even while muted,
 * so unmuting continues from this exact point.
 */
export function getReadingProgress() {
  return {
    cursor: Math.min(cursor, sessionText.length),
    total: sessionText.length,
    muted,
    speaking: speakingFlag,
  }
}

/** Markdown → words a voice should actually say. */
function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " Code block omitted for speech. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#*_>[\]()|-]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * The next mouthful starting at `pos`: whole sentences when possible, always
 * ending on a word boundary so nothing is cut in half.
 */
function chunkAt(pos: number): { text: string; start: number; end: number } | null {
  let start = pos
  while (start < sessionText.length && /\s/.test(sessionText[start])) start += 1
  if (start >= sessionText.length) return null

  if (sessionText.length - start <= CHUNK_MAX) {
    return { text: sessionText.slice(start), start, end: sessionText.length }
  }

  const window = sessionText.slice(start, start + CHUNK_MAX)
  let cut = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
    window.lastIndexOf("\n")
  )
  if (cut > 60) {
    cut += 1
  } else {
    const space = window.lastIndexOf(" ")
    cut = space > 60 ? space : window.length
  }
  const end = start + cut
  return { text: sessionText.slice(start, end).trim(), start, end }
}

/** Where the voice has reached right now, including mid-sentence progress. */
function estimateCursor(): number {
  if (!active) return Math.min(cursor, sessionText.length)
  const elapsed = Math.max(0, (Date.now() - anchorAt) / 1000)
  const span = active.chunkEnd - anchorCursor
  const consumed = Math.min(span, elapsed * CHARS_PER_SEC)
  return Math.min(sessionText.length, Math.floor(anchorCursor + consumed))
}

function stopSilentProgress() {
  if (silentTimer !== null && typeof window !== "undefined") {
    window.clearInterval(silentTimer)
  }
  silentTimer = null
}

/** While muted the cursor keeps moving, so unmuting resumes mid-sentence. */
function startSilentProgress() {
  if (!speechAvailable() || silentTimer !== null) return
  stopSilentProgress()
  const base = cursor
  const startedAt = Date.now()
  silentTimer = window.setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000
    const next = Math.min(sessionText.length, base + Math.floor(elapsed * CHARS_PER_SEC))
    if (next > cursor) cursor = next
    if (cursor >= sessionText.length) stopSilentProgress()
  }, 200)
}

function cancelAudio() {
  generation += 1
  active = null
  starting = false
  if (speechAvailable()) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* already idle */
    }
  }
  notifySpeaking()
}

/** Speak the next mouthful, then chain to the one after it. */
async function pump() {
  if (!speechAvailable() || active || starting) return
  if (muted && !speakWhileMuted) return

  const chunk = chunkAt(cursor)
  if (!chunk) {
    // Nothing left: a forced line has served its purpose.
    speakWhileMuted = false
    return
  }

  const gen = generation
  starting = true
  const list = await ensureVoices()
  // New text, a mute, or a stop happened while voices were loading.
  if (gen !== generation || active || (muted && !speakWhileMuted)) {
    starting = false
    return
  }

  const utter = new SpeechSynthesisUtterance(chunk.text)
  const voice = pickVoice(list)
  if (voice) utter.voice = voice
  utter.rate = SPEECH_RATE
  utter.pitch = 1
  utter.volume = 1

  active = { utter, chunkStart: chunk.start, chunkEnd: chunk.end }
  anchorCursor = chunk.start
  anchorAt = Date.now()
  starting = false
  notifySpeaking()

  // Word boundaries give exact progress, so muting mid-sentence is precise.
  utter.onboundary = (event: SpeechSynthesisEvent) => {
    if (active?.utter !== utter) return
    const index = typeof event.charIndex === "number" ? event.charIndex : 0
    const at = Math.min(chunk.end, chunk.start + index)
    if (at > cursor) cursor = at
    anchorCursor = at
    anchorAt = Date.now()
  }

  const finish = () => {
    if (active?.utter !== utter) return
    active = null
    cursor = Math.max(cursor, chunk.end)
    notifySpeaking()
    void pump()
  }
  utter.onend = finish
  utter.onerror = finish

  try {
    // Chrome parks its own queue after long silences. Nudge it awake.
    window.speechSynthesis.resume()
    window.speechSynthesis.speak(utter)
  } catch {
    finish()
  }
}

/** Read `text` from the beginning, discarding whatever came before. */
export function speak(text: string, opts: { force?: boolean } = {}) {
  if (!speechAvailable()) return
  const plain = speakable(text)
  if (!plain) return

  // Discard the previous text immediately — never finish it first.
  cancelAudio()
  stopSilentProgress()
  sessionText = plain
  cursor = 0
  speakWhileMuted = opts.force === true

  if (muted && !speakWhileMuted) startSilentProgress()
  else void pump()
}

/** Extend the active text (a reply still streaming in) without restarting. */
function appendReading(text: string) {
  if (!speechAvailable()) return
  const plain = speakable(text)
  if (!plain) return

  sessionText = sessionText ? `${sessionText} ${plain}` : plain
  if (cursor >= sessionText.length) cursor = sessionText.length

  if (muted && !speakWhileMuted) startSilentProgress()
  else void pump()
}

/** Hard stop: silence, forget the text, reset progress. */
export function stopSpeaking() {
  cancelAudio()
  stopSilentProgress()
  sessionText = ""
  cursor = 0
  speakWhileMuted = false
}

/**
 * Mute or unmute. Muting silences the voice instantly but keeps the reading
 * position moving; unmuting resumes from exactly where it got to.
 */
export function setMuted(nextMuted: boolean) {
  if (nextMuted === muted) return
  muted = nextMuted

  if (muted) {
    // Freeze the cursor where the voice actually was, then stop the audio.
    if (active) cursor = Math.max(cursor, estimateCursor())
    if (!speakWhileMuted) {
      cancelAudio()
      startSilentProgress()
    }
    return
  }

  stopSilentProgress()
  speakWhileMuted = false
  void pump()
}

/**
 * Read `full`, skipping anything before `spoken` characters — lets the stream
 * feed JARVIS sentence-by-sentence so it starts talking while still composing.
 *
 * `reset` starts a brand-new reading session (first line of a reply);
 * `flush` reads the remainder even without a closing full stop.
 */
export function speakRemainder(
  full: string,
  spoken: number,
  opts: { reset?: boolean; flush?: boolean } = {}
): number {
  if (!speechAvailable()) return spoken

  const end = opts.flush ? full.length : findSentenceEnd(full, Math.max(spoken, opts.reset ? 0 : 30))
  if (end <= spoken) return spoken

  const segment = full.slice(spoken, end)
  if (!segment.trim()) return end

  if (opts.reset) speak(segment)
  else appendReading(segment)
  return end
}

function findSentenceEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === "\n") return i + 1
    if ((c === "." || c === "?" || c === "!") && i + 1 < text.length) {
      // End of sentence only if followed by whitespace or another sentence.
      if (/[\s"'*)\]]/.test(text[i + 1]) && !/\d/.test(text[i - 1] ?? "")) return i + 1
    }
  }
  // Nothing complete yet: if the buffer is large, flush it anyway.
  if (text.length - from > 420) return text.length
  return -1
}

/** Legacy voice switch: "voice on" is simply unmuted. */
export function setVoiceEnabled(on: boolean) {
  setMuted(!on)
}

export const speechRecognitionSupported = () =>
  typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

type Rec = {
  start: () => void
  stop: () => void
}

/** Hook up continuous-ish dictation: returns null when unsupported. */
export function useSpeechRecognition(opts: {
  onResult: (text: string, isFinal: boolean) => void
  onError?: () => void
}): Rec | null {
  const ref = React.useRef<any>(null)
  const optsRef = React.useRef(opts)
  optsRef.current = opts

  React.useEffect(() => {
    if (!speechRecognitionSupported()) return
    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new Ctor()
    rec.lang = "en-US"
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (e: any) => {
      let interim = ""
      let final = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      if (final) optsRef.current.onResult(final.trim(), true)
      else if (interim) optsRef.current.onResult(interim.trim(), false)
    }
    rec.onerror = () => optsRef.current.onError?.()
    rec.onend = () => optsRef.current.onError?.()
    ref.current = rec
    return () => {
      try {
        rec.abort()
      } catch {
        /* noop */
      }
      ref.current = null
    }
  }, [])

  if (!speechRecognitionSupported()) return null
  return {
    start: () => ref.current?.start(),
    stop: () => ref.current?.stop(),
  }
}
