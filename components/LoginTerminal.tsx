"use client"

import * as React from "react"

/**
 * jarvis powershell — the login terminal.
 *
 * Styled like a Windows Terminal window running PowerShell: title bar,
 * scrollback, `PS C:\jarvis>` prompts, typed boot banner. Commands:
 *
 *   signup  → name → email → password   (creates the account server-side)
 *   login   → identity → password        (email or username)
 *   help / clear / version / whoami / exit
 *
 * Every field is submitted to /api/auth/* — verification and password
 * hashing (PBKDF2) happen on the server; the session lands as an HttpOnly
 * cookie.
 */

type Line = { text: string; cls?: "boot" | "cmd" | "ok" | "err" | "dim" | "accent" }

type Wizard = {
  kind: "signup" | "login"
  step: number
  fields: Record<string, string>
}

const BOOT: Line[] = [
  { text: "JARVIS OS [Version 0.5.0]", cls: "boot" },
  { text: "(c) JARVIS Systems. All rights reserved.", cls: "dim" },
  { text: "", cls: "dim" },
  { text: "Establishing secure channel ................ OK", cls: "ok" },
  { text: "Loading authentication module ............. OK", cls: "ok" },
  { text: "Verifying terminal integrity .............. OK", cls: "ok" },
  { text: "", cls: "dim" },
  { text: "Secure login terminal ready.", cls: "accent" },
  { text: "Type 'signup' to create an account, 'login' to sign in, 'help' for commands.", cls: "dim" },
  { text: "", cls: "dim" },
]

function promptFor(w: Wizard | null): string {
  if (!w) return "PS C:\\jarvis>"
  if (w.kind === "signup") {
    return ["", "[1/3] Name:", "[2/3] Email:", "[3/3] Password:"][w.step] ?? ""
  }
  return ["", "[1/2] Email or username:", "[2/2] Password:"][w.step] ?? ""
}

const CLASSES: Record<NonNullable<Line["cls"]>, string> = {
  boot: "text-slate-300",
  cmd: "text-slate-100",
  ok: "text-emerald-400",
  err: "text-red-400",
  dim: "text-slate-500",
  accent: "text-arc-bright",
}

export default function LoginTerminal({ onAuth }: { onAuth: () => void }) {
  const [lines, setLines] = React.useState<Line[]>([])
  const [wizard, setWizard] = React.useState<Wizard | null>(null)
  const [value, setValue] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [booted, setBooted] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  // Typewriter boot sequence
  React.useEffect(() => {
    let i = 0
    const timer = setInterval(() => {
      i++
      setLines(BOOT.slice(0, i))
      if (i >= BOOT.length) {
        clearInterval(timer)
        setBooted(true)
      }
    }, 170)
    return () => clearInterval(timer)
  }, [])

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    if (booted) inputRef.current?.focus()
  }, [lines, wizard, booted])

  const print = (...newLines: Line[]) => setLines((p) => [...p, ...newLines])

  const resetPrompt = () => {
    setWizard(null)
    setValue("")
  }

  const finishAuth = async (path: string, payload: Record<string, string>) => {
    setBusy(true)
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        print({ text: `ERROR: ${data.error ?? "Request failed."}`, cls: "err" })
        resetPrompt()
        return
      }
      const name = data?.user?.username ?? "operator"
      print(
        { text: "ACCESS GRANTED", cls: "ok" },
        { text: `Signed in as ${name}.`, cls: "accent" },
        { text: "Establishing secure session ............... OK", cls: "ok" },
        { text: "Handing control to JARVIS…", cls: "dim" }
      )
      setTimeout(onAuth, 700)
    } catch {
      print({ text: "ERROR: cannot reach the authentication server.", cls: "err" })
      resetPrompt()
    } finally {
      setBusy(false)
    }
  }

  const advance = (raw: string) => {
    if (!wizard) return
    const w = { ...wizard, fields: { ...wizard.fields } }

    if (w.kind === "signup") {
      // w.step is 1-based — map to the 0-based field array.
      const key = ["username", "email", "password"][w.step - 1]
      const masked =
        key === "password" ? "•".repeat(Math.min(raw.length, 12)) : raw.trim()
      if (raw.trim()) print({ text: `${promptFor(w)} ${masked}`, cls: "cmd" })
      w.fields[key] = raw
    } else {
      const key = w.step === 1 ? "identity" : "password"
      const masked = key === "password" ? "•".repeat(Math.min(raw.length, 12)) : raw.trim()
      if (raw.trim()) print({ text: `${promptFor(w)} ${masked}`, cls: "cmd" })
      w.fields[key] = raw
    }

    setValue("")

    if (w.kind === "signup" && w.step < 3) {
      w.step += 1
      setWizard(w)
      return
    }
    if (w.kind === "login" && w.step < 2) {
      w.step += 1
      setWizard(w)
      return
    }

    // Wizard complete → server
    setWizard(w)
    if (w.kind === "signup") {
      void finishAuth("/api/auth/register", w.fields)
    } else {
      void finishAuth("/api/auth/login", w.fields)
    }
  }

  const runCommand = (input: string) => {
    const cmd = input.trim()
    print({ text: `PS C:\\jarvis> ${cmd}`, cls: "cmd" })
    setValue("")
    const [head] = cmd.toLowerCase().split(/\s+/)

    switch (head) {
      case "":
        return
      case "signup":
      case "register":
      case "new-user":
        print({ text: "New account registration. Press Esc to cancel.", cls: "dim" })
        print({ text: "[1/3] Name:", cls: "accent" })
        setWizard({ kind: "signup", step: 1, fields: {} })
        return
      case "login":
      case "signin":
      case "sign-in":
        print({ text: "Interactive logon. Press Esc to cancel.", cls: "dim" })
        print({ text: "[1/2] Email or username:", cls: "accent" })
        setWizard({ kind: "login", step: 1, fields: {} })
        return
      case "help":
      case "?":
        print(
          { text: "Commands:", cls: "accent" },
          { text: "  signup   Create a JARVIS account (name, email, password)", cls: "boot" },
          { text: "  login    Sign in with your email or username", cls: "boot" },
          { text: "  whoami   Show the current session", cls: "boot" },
          { text: "  version  Show terminal version", cls: "boot" },
          { text: "  clear    Clear the screen", cls: "boot" }
        )
        return
      case "whoami":
        print({ text: "nt authority\\anonymous logon (no session)", cls: "dim" })
        return
      case "version":
      case "ver":
        print({ text: "jarvis powershell — JARVIS OS [Version 0.5.0]", cls: "boot" })
        return
      case "clear":
      case "cls":
        setLines([])
        return
      case "exit":
      case "quit":
        print({ text: "There is no escape. Type 'login' or 'signup'.", cls: "err" })
        return
      default:
        print({
          text: `'${head}' is not recognized as an internal or external command. Type 'help'.`,
          cls: "err",
        })
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (wizard) advance(value)
    else runCommand(value)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && wizard) {
      print({ text: "^C  Command cancelled.", cls: "dim" })
      resetPrompt()
    }
  }

  const prompt = wizard
    ? promptFor(wizard)
    : "PS C:\\jarvis>"
  const isPasswordPrompt =
    !!wizard &&
    ((wizard.kind === "signup" && wizard.step === 3) ||
      (wizard.kind === "login" && wizard.step === 2))

  return (
    <div className="flex min-h-screen items-center justify-center bg-void p-3 sm:p-6">
      <div className="flex h-[min(88vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-edge bg-[#0c0c12] shadow-2xl">
        {/* Title bar — Windows Terminal style */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge bg-[#101018] px-3 select-none">
          <div className="flex items-center gap-2.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-[#2b6cb0] text-[9px] font-bold text-white">
              &gt;_
            </span>
            <span className="text-[11.5px] text-slate-400">
              jarvis powershell — JARVIS OS
            </span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            <span className="hover:text-slate-300">—</span>
            <span className="hover:text-slate-300">□</span>
            <span className="hover:text-red-400">✕</span>
          </div>
        </div>

        {/* Scrollback */}
        <div
          ref={scrollRef}
          onClick={() => inputRef.current?.focus()}
          className="flex-1 cursor-text overflow-y-auto px-4 py-3 font-mono text-[13px] leading-6"
        >
          {/* ASCII banner */}
          <pre className="mb-2 select-none text-[11px] leading-4 text-arc">
{String.raw`╔══════════════════════════════════════════════╗`}
{String.raw`║   J A R V I S  —  PERSONAL AI SYSTEM  v0.5   ║`}
{String.raw`╚══════════════════════════════════════════════╝`}
          </pre>

          {lines.map((l, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap ${l.cls ? CLASSES[l.cls] : "text-slate-300"}`}
            >
              {l.text || "\u00A0"}
            </div>
          ))}

          {/* Live prompt */}
          {booted && (
            <form onSubmit={onSubmit} className="mt-0.5 flex items-center gap-2">
              <span className="shrink-0 text-arc-bright">{prompt}</span>
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={onKeyDown}
                type={isPasswordPrompt ? "password" : "text"}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                aria-label={prompt}
                className="min-w-0 flex-1 border-none bg-transparent font-mono text-[13px] text-slate-100 caret-arc-bright outline-none placeholder:text-slate-700 disabled:opacity-50"
                placeholder={busy ? "" : wizard ? "" : "type a command…"}
              />
              <span className="inline-block h-4 w-2 shrink-0 animate-pulse-soft bg-arc/70" />
            </form>
          )}
        </div>

        {/* Status bar */}
        <div className="flex h-7 shrink-0 items-center justify-between border-t border-edge bg-[#101018] px-3 font-mono text-[10px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                busy ? "animate-pulse-soft bg-amber-400" : booted ? "bg-emerald-400" : "bg-slate-600"
              }`}
            />
            {busy ? "authenticating…" : booted ? "secure channel ready" : "booting…"}
          </span>
          <span>PBKDF2-SHA256 · 150k · HttpOnly session</span>
        </div>
      </div>
    </div>
  )
}
