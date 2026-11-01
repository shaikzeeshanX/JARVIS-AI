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

/** Cancel anything currently speaking. */
export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
}

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

export async function speak(text: string, rate = 1.0) {
  if (typeof window === "undefined" || !window.speechSynthesis) return
  stopSpeaking()
  // Strip markdown so the voice doesn't read "# asterisks" aloud.
  const plain = text
    .replace(/```[\s\S]*?```/g, " Code block omitted for speech. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#*_>[\]()|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!plain) return

  const list = await ensureVoices()
  const utter = new SpeechSynthesisUtterance(plain)
  const voice = pickVoice(list)
  if (voice) utter.voice = voice
  utter.rate = rate
  utter.pitch = 1
  window.speechSynthesis.speak(utter)
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
