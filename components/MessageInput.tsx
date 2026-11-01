"use client"

import * as React from "react"
import { useSpeechRecognition } from "@/lib/speech"

/**
 * The single input JARVIS listens on. No upload buttons, no research toggles —
 * every capability is reached by speaking to JARVIS:
 *
 *   "choose files"      → JARVIS opens the file picker
 *   "show history"      → JARVIS opens the conversation history
 *   "stop / quit / end" → JARVIS halts speech and generation
 *   "be quiet / voice on" → mute / unmute
 */
export default function MessageInput({
  onSend,
  onVoiceSend,
  busy,
  voiceOn,
  uploading,
}: {
  onSend: (text: string) => void
  /** A completed spoken line — auto-sent, and the signal that flips JARVIS
   *  into his side-of-screen presence mode. */
  onVoiceSend?: (text: string) => void
  busy: boolean
  voiceOn: boolean
  uploading: boolean
}) {
  const [value, setValue] = React.useState("")
  const [listening, setListening] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  // True when the textarea was empty at mic start — the box is then pure
  // dictation, so a completed line is sent straight to JARVIS.
  const pureDictationRef = React.useRef(false)

  const rec = useSpeechRecognition({
    onResult: (text, isFinal) => {
      if (pureDictationRef.current) {
        if (isFinal) {
          const line = text.trim()
          setListening(false)
          if (line) (onVoiceSend ?? onSend)(line)
          setValue("")
          if (textareaRef.current) textareaRef.current.style.height = "auto"
        } else {
          // Live dictation preview while the user speaks.
          setValue(text)
        }
        return
      }
      // Typed text already present — just append the final speech.
      if (isFinal) {
        setValue((prev) => `${prev} ${text}`.trim())
        setListening(false)
      }
    },
    onError: () => setListening(false),
  })

  const submit = () => {
    const text = value.trim()
    // Commands like "stop" must go through even while JARVIS is working —
    // the app decides what to do with them.
    if (!text) return
    onSend(text)
    setValue("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  const toggleMic = () => {
    if (!rec) return
    if (listening) {
      rec.stop()
      setListening(false)
    } else {
      pureDictationRef.current = !value.trim()
      rec.start()
      setListening(true)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <div
        className={`flex items-end gap-2 rounded-2xl border bg-panel/90 p-2 shadow-glow backdrop-blur transition ${
          listening ? "border-red-400/60" : "border-edge focus-within:border-arc/50"
        }`}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            e.target.style.height = "auto"
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={
            listening
              ? "Listening…"
              : uploading
                ? "JARVIS is reading your files…"
                : "Talk to JARVIS — or type a command…"
          }
          className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />

        {/* Microphone */}
        <button
          onClick={toggleMic}
          disabled={!rec}
          title={
            rec
              ? listening
                ? "Stop listening"
                : "Speak to JARVIS"
              : "Speech recognition not supported in this browser"
          }
          className={`mb-1 rounded-xl p-2.5 transition ${
            listening
              ? "bg-red-500/20 text-red-400 animate-pulse-soft"
              : "text-slate-500 hover:bg-edge/50 hover:text-arc-bright disabled:hover:bg-transparent"
          }`}
        >
          {listening ? "⏹" : "🎤"}
        </button>

        {/* Send */}
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="mb-1 rounded-xl bg-arc px-4 py-2.5 text-sm font-semibold text-void shadow-glow transition hover:bg-arc-bright disabled:cursor-not-allowed disabled:bg-edge disabled:text-slate-600 disabled:shadow-none"
        >
          {busy ? "…" : "Send"}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-slate-600">
        <span className="hidden sm:inline">
          Say “choose files” · “show history” · “stop” · “voice off”
        </span>
        <span className="sm:hidden">Speak or type a command</span>
        <span className="font-mono">jarvis v0.4 · voice os</span>
      </div>
    </div>
  )
}
