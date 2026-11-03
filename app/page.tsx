"use client"

import * as React from "react"
import Sidebar from "@/components/Sidebar"
import ChatView from "@/components/ChatView"
import MessageInput from "@/components/MessageInput"
import JarvisOrb from "@/components/JarvisOrb"
import KnowledgePanel from "@/components/KnowledgePanel"
import LoginTerminal from "@/components/LoginTerminal"
import type { Conversation, DocExcerpt, Message, Source } from "@/lib/types"
import {
  loadConversations,
  newConversation,
  saveConversations,
  titleFrom,
  uid,
} from "@/lib/store"
import { allDocs, putDoc } from "@/lib/db"
import { retrieve } from "@/lib/chunk"
import {
  detectCommand,
  type CommandIntent,
} from "@/lib/commands"
import {
  setVoiceEnabled,
  speak,
  speakRemainder,
  stopSpeaking,
} from "@/lib/speech"

/**
 * JARVIS — voice-first, Linux-style.
 *
 * Everything happens by talking to JARVIS: it opens the file picker, opens
 * history, starts and stops conversations on command. There are no visible
 * upload buttons or history shortcuts — the interface only listens.
 */

/** Turn an error response into the message the user should read. */
async function readError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "")
  if (!raw) return "Request failed."
  try {
    const data = JSON.parse(raw)
    if (data && typeof data.error === "string") return data.error
  } catch {
    /* plain-text error — use it as-is */
  }
  return raw
}

export default function Home() {
  const [conversations, setConversations] = React.useState<Conversation[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [voiceOn, setVoiceOn] = React.useState(true)
  const [mode, setMode] = React.useState<
    "unknown" | "ollama" | "live" | "offline"
  >("unknown")
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [kbOpen, setKbOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [docCount, setDocCount] = React.useState(0)
  const [auth, setAuth] = React.useState<"loading" | "gate" | "lock" | "in">("loading")
  const [sessionUser, setSessionUser] = React.useState<string | null>(null)
  // Presence layout by default: JARVIS's cube keeps the right side of the
  // screen during a typed conversation too, not only when you speak.
  const [split, setSplit] = React.useState(true)
  const loadedRef = React.useRef(false)

  // ── Session check — the server owns authentication ─────────
  // A valid cookie does NOT skip the terminal: on every fresh open the
  // user must re-enter their password (Linux-style lock screen).
  React.useEffect(() => {
    let alive = true
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return
        if (r.ok) {
          const data = await r.json().catch(() => ({}))
          setSessionUser(data?.user?.username ?? null)
          setAuth("lock")
        } else {
          setAuth("gate")
        }
      })
      .catch(() => {
        if (alive) setAuth("gate")
      })
    return () => {
      alive = false
    }
  }, [])

  // Abort machinery
  const abortRef = React.useRef(false)
  const stopRequestedRef = React.useRef(false)
  // Set while JARVIS's file picker is open; next upload = picker flow.
  const filesPromptRef = React.useRef(0)
  const activeIdRef = React.useRef<string | null>(null)
  activeIdRef.current = activeId

  React.useEffect(() => {
    setVoiceEnabled(true)
  }, [])

  React.useEffect(() => {
    setVoiceEnabled(voiceOn)
  }, [voiceOn])

  // ── Restore history on first paint ─────────────────────────
  React.useEffect(() => {
    const stored = loadConversations()
    if (stored.length > 0) {
      setConversations(stored)
      setActiveId(stored[0].id)
    } else {
      const c = newConversation()
      setConversations([c])
      setActiveId(c.id)
    }
    loadedRef.current = true
  }, [])

  // ── Persist on every change ────────────────────────────────
  React.useEffect(() => {
    if (loadedRef.current) saveConversations(conversations)
  }, [conversations])

  // ── Per-user server memory: pull after unlock, push debounced ──
  const memLoadedRef = React.useRef(false)
  React.useEffect(() => {
    if (auth !== "in" || memLoadedRef.current) return
    memLoadedRef.current = true
    let alive = true
    fetch("/api/memory", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !Array.isArray(data?.conversations)) return
        const remote = data.conversations as Conversation[]
        if (remote.length === 0) return
        setConversations((prev) => {
          const byId = new Map(remote.map((c) => [c.id, c]))
          // Local newer copy wins for the same id.
          for (const c of prev) {
            const r = byId.get(c.id)
            if (!r || (c.updatedAt ?? 0) >= (r.updatedAt ?? 0)) byId.set(c.id, c)
          }
          const merged = [...byId.values()].sort(
            (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
          )
          return merged
        })
        setActiveId((current) => current ?? remote[0].id)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [auth])

  const memTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    if (auth !== "in" || !loadedRef.current) return
    if (memTimerRef.current) clearTimeout(memTimerRef.current)
    memTimerRef.current = setTimeout(() => {
      void fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversations }),
      }).catch(() => {})
    }, 2500)
    return () => {
      if (memTimerRef.current) clearTimeout(memTimerRef.current)
    }
  }, [conversations, auth])

  const active = conversations.find((c) => c.id === activeId) ?? null

  const patchActive = (fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === activeIdRef.current ? fn(c) : c)))
  }

  // ── A locally-handled command reply, spoken immediately ────
  const runLocal = React.useCallback(
    (say: string, opts: { intent?: CommandIntent; forceSpeech?: boolean; silent?: boolean } = {}) => {
      const id = uid()
      patchActive((c) => ({
        ...c,
        messages: [
          ...c.messages,
          {
            id,
            role: "assistant" as const,
            content: say,
            createdAt: Date.now(),
            intent: opts.intent?.kind,
          },
        ],
        updatedAt: Date.now(),
      }))
      if (!opts.silent && say) {
        if (voiceOnRef.current || opts.forceSpeech) void speak(say)
      }
      return id
    },
    []
  )

  const voiceOnRef = React.useRef(voiceOn)
  voiceOnRef.current = voiceOn

  // ── Local commands (the terminal builtins) ─────────────────
  const runCommand = React.useCallback(
    (intent: CommandIntent): boolean => {
      switch (intent.kind) {
        case "stop":
          if (abortRef.current) stopRequestedRef.current = true
          stopSpeaking()
          if (!abortRef.current) runLocal("Stopped.", { intent })
          return true

        case "voice-on":
          stopSpeaking()
          setVoiceOn(true)
          runLocal("Voice on. I'm listening.", { intent, forceSpeech: true })
          return true

        case "voice-off":
          setVoiceOn(false)
          runLocal("Voice off. I'll keep it quiet from here.", {
            intent,
            forceSpeech: true,
          })
          return true

        case "history": {
          setSidebarOpen(true)
          const list = conversationsRef.current
          const lines = list
            .slice(0, 8)
            .map(
              (c, i) =>
                `${i + 1}. ${c.title} — ${c.messages.length} message${c.messages.length === 1 ? "" : "s"}`
            )
            .join("\n")
          const current = activeRef.current
          const say =
            `Here is our chat history, sir. ` +
            (current
              ? `You are now in "${current.title}". `
              : "") +
            (list.length > 0
              ? `You have ${list.length} conversation${list.length === 1 ? "" : "s"}:\n${lines}\nSay "open chat history" any time to see them on screen.`
              : "The history is empty so far.")
          runLocal(say, { intent })
          return true
        }

        case "files": {
          runLocal(intent.say ?? "Opening the file picker.", { intent, silent: true })
          filesPromptRef.current = Date.now()
          const input = document.getElementById("jarvis-file-picker") as HTMLInputElement | null
          input?.click()
          return true
        }

        case "library": {
          setKbOpen(true)
          const docs = docsRef.current
          const say =
            docs.length > 0
              ? `Opening the knowledge base. You have ${docs.length} item${
                  docs.length === 1 ? "" : "s"
                }: ${docs.map((d) => d.name).join(", ")}. Say "choose files" to add more.`
              : `The knowledge base is empty. Say "choose files" and pick something for me to learn.`
          runLocal(say, { intent })
          return true
        }

        case "clear": {
          const fresh = newConversation()
          setConversations((prev) => [fresh, ...prev])
          setActiveId(fresh.id)
          const say = intent.say ?? "Conversation cleared."
          patchActiveTo(fresh.id, say, intent)
          if (voiceOnRef.current) void speak(say)
          return true
        }

        case "logout": {
          runLocal(intent.say ?? "Signing out.", { intent, forceSpeech: true })
          void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
            stopSpeaking()
            setSessionUser(null)
            setAuth("gate")
          })
          return true
        }
      }
      return false
    },
    []
  )

  // Helpers used inside runCommand (stable refs)
  const conversationsRef = React.useRef<Conversation[]>([])
  conversationsRef.current = conversations
  const activeRef = React.useRef<Conversation | null>(null)
  activeRef.current = active
  const docsRef = React.useRef<Array<{ name: string }>>([])
  React.useEffect(() => {
    void allDocs().then((d) => {
      docsRef.current = d
      setDocCount(d.length)
    })
  }, [docCount])

  const patchActiveTo = React.useCallback(
    (conversationId: string, say: string, intent?: CommandIntent) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  {
                    id: uid(),
                    role: "assistant" as const,
                    content: say,
                    createdAt: Date.now(),
                    intent: intent?.kind,
                  },
                ],
                updatedAt: Date.now(),
              }
            : c
        )
      )
    },
    []
  )

  // ── The main send path ─────────────────────────────────────
  const send = async (text: string) => {
    // 1) Local command? Checked FIRST so "stop"/"quit" work mid-stream.
    const intent = detectCommand(text)
    if (intent) {
      runCommand(intent)
      return
    }

    if (!active || busy) return

    stopSpeaking()
    abortRef.current = false
    stopRequestedRef.current = false

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    }
    const assistantId = uid()
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }

    const history = [...active.messages, userMsg]
    patchActive((c) => ({
      ...c,
      title: c.messages.length === 0 ? titleFrom(text) : c.title,
      messages: [...history, assistantMsg],
      updatedAt: Date.now(),
    }))
    setBusy(true)

    // Retrieve relevant excerpts from the private library — client-side, so
    // only these snippets ever leave the browser.
    let context: DocExcerpt[] = []
    if (docCount > 0) {
      try {
        const library = await allDocs()
        context = retrieve(
          text,
          library.map((d) => ({ name: d.name, text: d.text })),
          4,
          4000
        ).map((e) => ({ doc: e.doc, text: e.text }))
      } catch {
        context = []
      }
    }

    // Voice state for this response
    let spoken = 0
    let spokenStarted = false
    const speakNow = voiceOnRef.current

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          research: "auto",
          context,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      })

      const headerMode = res.headers.get("x-jarvis-mode")
      if (headerMode === "ollama" || headerMode === "live") setMode(headerMode)
      else if (headerMode === "offline") setMode("offline")

      if (!res.ok || !res.body) {
        throw new Error(await readError(res))
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ""
      let headerParsed = false
      let sources: Source[] = []
      let docNames: string[] = []

      const apply = (content: string, done = false) => {
        patchActive((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content,
                  sources: sources.length > 0 ? sources : undefined,
                  docs: docNames.length > 0 ? docNames : undefined,
                }
              : m
          ),
          ...(done ? { updatedAt: Date.now() } : {}),
        }))
      }

      for (;;) {
        if (abortRef.current || stopRequestedRef.current) {
          try {
            await reader.cancel()
          } catch {
            /* already closed */
          }
          break
        }
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })

        // First line of the stream is a JSON header carrying sources + docs.
        if (!headerParsed) {
          const nl = acc.indexOf("\n")
          if (nl >= 0) {
            try {
              const header = JSON.parse(acc.slice(0, nl))
              if (Array.isArray(header?.sources)) sources = header.sources
              if (Array.isArray(header?.docs)) docNames = header.docs
            } catch {
              /* not a header — treat as content */
            }
            acc = acc.slice(nl + 1)
            headerParsed = true
          }
        }

        // Voice: start talking at the first complete sentence, then feed
        // sentence-by-sentence while the rest is still streaming.
        if (speakNow && !spokenStarted && acc.trim().length > 12) {
          spokenStarted = true
          spoken = speakRemainder(acc, spoken)
        } else if (speakNow && spokenStarted && !stopRequestedRef.current) {
          spoken = speakRemainder(acc, spoken)
        }

        apply(acc)
      }

      const finalText =
        acc.trim() || "I couldn't produce a response. Please try again."
      const wasStopped = stopRequestedRef.current

      patchActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: finalText,
                sources: sources.length > 0 ? sources : undefined,
                docs: docNames.length > 0 ? docNames : undefined,
              }
            : m
        ),
        updatedAt: Date.now(),
      }))

      // Speak whatever is left — unless JARVIS was stopped mid-reply.
      if (speakNow && !wasStopped && spoken < finalText.length) {
        const remainder = finalText.slice(spoken).trim()
        if (remainder && (!spokenStarted || spoken === 0)) void speak(finalText)
        else if (remainder) void speak(remainder)
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message.slice(0, 300)
          : "Something went wrong. Please try again."
      patchActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantId ? { ...m, content: `⚠ ${message}` } : m
        ),
      }))
    } finally {
      abortRef.current = false
      stopRequestedRef.current = false
      setBusy(false)
    }
  }

  // Voice-first: the first spoken line flips JARVIS into "presence" mode —
  // he moves to the right of the screen, conversation takes the left.
  const sendVoiceLine = (text: string) => {
    setSplit(true)
    void send(text)
  }

  const newChat = () => {
    stopSpeaking()
    const c = newConversation()
    setConversations((prev) => [c, ...prev])
    setActiveId(c.id)
  }

  const selectChat = (id: string) => {
    stopSpeaking()
    setActiveId(id)
  }

  const deleteChat = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id)
      if (next.length === 0) {
        const c = newConversation()
        setActiveId(c.id)
        return [c]
      }
      if (id === activeId) setActiveId(next[0].id)
      return next
    })
  }

  // ── The picker flow: JARVIS opens it, the user chooses ─────
  const uploadFiles = async (files: File[]) => {
    if (uploading || files.length === 0) return
    setUploading(true)
    const fromPicker = Date.now() - filesPromptRef.current < 90_000
    filesPromptRef.current = 0
    try {
      const form = new FormData()
      for (const f of files) form.append("files", f)

      const res = await fetch("/api/parse", { method: "POST", body: form })
      if (!res.ok) throw new Error("Parser unavailable.")
      const data = await res.json()

      let added = 0
      const failed: string[] = []
      for (const f of data.files ?? []) {
        if (f.ok && f.text) {
          await putDoc({
            id: uid(),
            name: f.name,
            kind: "document",
            chars: f.chars,
            text: f.text,
            createdAt: Date.now(),
          })
          added++
        } else {
          failed.push(f.name)
        }
      }

      setDocCount((await allDocs()).length)

      if (!fromPicker) return // silent background upload

      setKbOpen(true) // show JARVIS what it just received

      if (added > 0) {
        const names = files.map((f) => f.name).join(", ")
        const say =
          `Received ${added} file${added === 1 ? "" : "s"}: ${names}. ` +
          `I've added them to the knowledge base. What would you like to know about them?`
        runLocal(say, {})
      } else {
        runLocal(
          `I couldn't read ${failed.length} of those files — only PDF, Word, TXT, Markdown, CSV and JSON are supported.`,
          {}
        )
      }
    } catch (err) {
      console.error("Upload failed:", err)
      if (fromPicker) runLocal("Upload failed — I couldn't reach the parser.", {})
    } finally {
      setUploading(false)
    }
  }

  // Ctrl/Cmd+K → new chat
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        newChat()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const statusText =
    mode === "live"
      ? "AI ONLINE · OPENAI"
      : mode === "ollama"
        ? "LOCAL AI · OLLAMA"
        : mode === "offline"
          ? "AI OFFLINE"
          : "STARTING…"

  const statusColor =
    mode === "live"
      ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]"
      : mode === "ollama"
        ? "bg-arc-bright shadow-[0_0_10px_rgba(92,200,255,0.8)]"
        : mode === "offline"
          ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"
          : "bg-slate-500"

  // ── Auth gate ───────────────────────────────────────────────
  if (auth === "loading") {
    return (
      <main className="flex h-screen items-center justify-center bg-void">
        <div className="flex flex-col items-center gap-4">
          <JarvisOrb size={72} busy />
          <span className="font-mono text-xs tracking-wide text-slate-500">
            verifying session…
          </span>
        </div>
      </main>
    )
  }
  if (auth === "gate" || auth === "lock") {
    return (
      <LoginTerminal
        mode={auth}
        username={sessionUser ?? undefined}
        onAuth={() => {
          memLoadedRef.current = false
          setAuth("in")
        }}
      />
    )
  }

  return (
    <main className="flex h-screen overflow-hidden">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onNew={newChat}
        onSelect={selectChat}
        onDelete={deleteChat}
        collapsed={!sidebarOpen}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Top bar ─────────────────────────────────────── */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-edge bg-panel/50 px-4 backdrop-blur">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-edge/50 hover:text-slate-200"
            aria-label="Toggle sidebar"
          >
            ☰
          </button>

          <div className="flex items-center gap-2">
            <JarvisOrb size={34} busy={busy} />
            <span className="font-semibold tracking-wide text-slate-100">
              JARVIS
            </span>
          </div>

          <div className="ml-2 hidden items-center gap-2 rounded-full border border-edge bg-void/60 px-3 py-1.5 sm:flex">
            <span
              className={`h-2 w-2 rounded-full ${statusColor} ${busy ? "animate-pulse-soft" : ""}`}
            />
            <span className="font-mono text-[10px] tracking-widest text-slate-400">
              {statusText}
            </span>
          </div>

          <div className="flex-1" />

          <button
            onClick={() => {
              const next = !voiceOn
              setVoiceOn(next)
              if (next) void speak("Voice on.")
            }}
            title={voiceOn ? "Voice on — say “be quiet” to mute" : "Muted — say “voice on” to unmute"}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
              voiceOn
                ? "border-arc/40 bg-arc/10 text-arc-bright hover:bg-arc/20"
                : "border-edge text-slate-500 hover:text-slate-300"
            }`}
          >
            {voiceOn ? "🔊" : "🔇"}
          </button>

          <button
            onClick={() => {
              void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
                stopSpeaking()
                setSessionUser(null)
                setAuth("gate")
              })
            }}
            title="Sign out (or say “log out”)"
            className="flex items-center gap-1.5 rounded-full border border-edge px-3 py-1.5 text-xs text-slate-500 transition hover:border-red-500/40 hover:text-red-400"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 3v8" />
              <path d="M17.5 6.5a7 7 0 1 1-11 0" />
            </svg>
            <span className="hidden sm:inline">Sign out</span>
          </button>

          <div className="hidden rounded-full border border-edge px-3 py-1.5 text-xs text-slate-500 md:block">
            Phase 4 · Voice OS
          </div>
        </header>

        {/* ── Chat ────────────────────────────────────────── */}
        <ChatView messages={active?.messages ?? []} busy={busy} split={split} />

        <MessageInput onSend={send} onVoiceSend={sendVoiceLine} busy={busy} voiceOn={voiceOn} uploading={uploading} />

        {/* JARVIS's file picker — opens ONLY when JARVIS says so */}
        <input
          id="jarvis-file-picker"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ""
            if (files.length > 0) void uploadFiles(files)
            else filesPromptRef.current = 0
          }}
        />
      </div>

      <KnowledgePanel
        open={kbOpen}
        onClose={() => setKbOpen(false)}
        uploading={uploading}
        count={docCount}
        onCountChange={setDocCount}
      />
    </main>
  )
}
