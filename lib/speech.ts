"use client"

import * as React from "react"

/**
 * Voice layer — Web Speech API (free, built into the browser, no API cost).
 *
 *  - speak(): text-to-speech, used to read every JARVIS reply aloud.
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

// ── Speaking queue + state ───────────────────────────────────
// Utterances are chained one after another and never cancelled implicitly.
// The old speak() called cancel() before every utterance, so while a reply was
// still streaming each new sentence cut the previous one off mid-word.

type SpeakingListener = (speaking: boolean) => void

const speakingListeners = new Set<SpeakingListener>()
let speakQueue: string[] = []
let utterActive = false
let speakingFlag = false
/** Bumped by stopSpeaking() so an in-flight utterance can't resurrect a queue. */
let speakGeneration = 0

function notifySpeaking() {
  const next = utterActive || speakQueue.length > 0
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

/** True while JARVIS is reading anything aloud (queue included). */
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

/** Cancel anything currently speaking, and drop whatever was queued. */
export function stopSpeaking() {
  speakGeneration += 1
  speakQueue = []
  utterActive = false
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
  notifySpeaking()
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
 * Split into mouthfuls. Browsers silently truncate very long utterances
 * (Chrome around 15s), so each chunk is kept comfortably short while still
 * holding whole sentences — that keeps the pacing natural, no word skipped.
 */
function chunkForSpeech(text: string): string[] {
  const MAX = 240
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text]
  const out: string[] = []
  let current = ""
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX) {
      out.push(current.trim())
      current = ""
    }
    current += sentence
  }
  if (current.trim()) out.push(current.trim())
  return out.filter(Boolean)
}

/** Speak the next queued mouthful, then chain to the one after it. */
async function pumpSpeech() {
  if (typeof window === "undefined" || !window.speechSynthesis) return
  if (utterActive || speakQueue.length === 0) return

  const generation = speakGeneration
  const text = speakQueue.shift() as string
  utterActive = true
  notifySpeaking()

  const list = await ensureVoices()
  // stopSpeaking() ran while we were waiting for the voice list.
  if (generation !== speakGeneration) return

  const utter = new SpeechSynthesisUtterance(text)
  const voice = pickVoice(list)
  if (voice) utter.voice = voice
  utter.rate = SPEECH_RATE
  utter.pitch = 1
  utter.volume = 1

  const done = () => {
    utterActive = false
    notifySpeaking()
    void pumpSpeech()
  }
  utter.onend = done
  utter.onerror = done

  try {
    // Chrome pauses its own queue after long silences. Nudge it awake.
    window.speechSynthesis.resume()
    window.speechSynthesis.speak(utter)
  } catch {
    done()
  }
}

/** Steady, conversational pace — not rushed, not dragging. */
const SPEECH_RATE = 1.0

/**
 * Speak `full` but skip everything already covered by `spoken` characters —
 * lets the stream feed JARVIS sentence-by-sentence so it starts talking while
 * it's still composing. Returns the new spoken length.
 *
 * `force` speaks even when voice is muted (used for command confirmations
 * like "voice off" — JARVIS must be able to say it's going quiet).
 */
export function speakRemainder(
  full: string,
  spoken: number,
  opts: { force?: boolean } = {}
): number {
  if (opts.force !== true && !voiceEnabled()) return spoken
  if (typeof window === "undefined" || !window.speechSynthesis) return spoken

  const sentenceEnd = findSentenceEnd(full, Math.max(spoken, 30))
  if (sentenceEnd < 0) return spoken

  const segment = full.slice(spoken, sentenceEnd).trim()
  const next = sentenceEnd
  if (segment) void speak(segment)
  return next
}

function findSentenceEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === "\n") return i + 1
    if ((c === "." || c === "?" || c === "!" ) && i + 1 < text.length) {
      // End of sentence only if followed by whitespace or another sentence.
      if (/[\s"'*)\]]/.test(text[i + 1]) && !/\d/.test(text[i - 1] ?? "")) return i + 1
    }
  }
  // Nothing complete yet: if the buffer is large, flush it anyway.
  if (text.length - from > 420) return text.length
  return -1
}

/** Global voice switch — checked by speak streams; set by the app. */
let voiceOnState = true
export function setVoiceEnabled(on: boolean) {
  voiceOnState = on
}
function voiceEnabled() {
  return voiceOnState
}

/**
 * Queue text to be read aloud. Never cancels what is already being said, so a
 * streamed reply is spoken continuously instead of being restarted per chunk.
 */
export function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return
  const plain = speakable(text)
  if (!plain) return
  speakQueue.push(...chunkForSpeech(plain))
  notifySpeaking()
  void pumpSpeech()
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
