"use client"

import * as React from "react"

/**
 * JARVIS secure entry — two screens, one component.
 *
 *   mode="gate"  → first time / signed out: Gmail + Password + Confirm
 *                  (creates the account server-side, or signs in).
 *   mode="lock"  → a session exists: the Linux-style password terminal.
 *                  "Welcome back to JARVIS" / `user@jarvis:~$` /
 *                  "Enter your Jarvis password:" — verified server-side
 *                  via /api/auth/unlock on EVERY fresh open.
 *
 * Pure black, neon-green monospace, blinking cursor, typing animation.
 * Passwords are never stored client-side; only the signed HttpOnly
 * session cookie survives a successful unlock.
 */

type Mode = "gate" | "lock"

type Line = { text: string; cls?: "ok" | "err" | "dim" | "accent" | "white" }

const CLASSES: Record<NonNullable<Line["cls"]>, string> = {
  ok: "text-emerald-400",
  err: "text-red-400",
  dim: "text-emerald-700",
  accent: "text-emerald-300",
  white: "text-emerald-100",
}

/** Gmail prefix → unix-style username (zeeshan@gmail.com → zeeshan). */
function usernameFromEmail(email: string): string {
  const base = email
    .split("@")[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 20)
  if (base.length >= 3) return base
  return (base + Date.now().toString().slice(-4)).slice(0, 24)
}

/**
 * Types lines in character-by-character, like a real terminal.
 *
 * Writes directly into a DOM container (a real terminal prints — it doesn't
 * re-render). React only owns the container element and the final `done`
 * flag; the text itself never goes through state.
 */
function useTypewriter(
  lines: string[],
  speed = 16,
  firstClass = "text-emerald-300"
) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [done, setDone] = React.useState(lines.length === 0)

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) {
      setDone(true)
      return
    }
    let cancelled = false
    let li = 0
    let ci = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    // Build one node per line; React never diffs these (container has no
    // JSX children), so manual writes are safe across re-renders.
    const nodes = lines.map((line, i) => {
      const div = document.createElement("div")
      div.className = i === 0 ? firstClass : "text-emerald-600"
      div.textContent = "\u00A0"
      return div
    })
    el.replaceChildren(...nodes)

    const tick = () => {
      if (cancelled) return
      if (li >= lines.length) {
        setDone(true)
        return
      }
      const line = lines[li]
      nodes[li].textContent = line.slice(0, ci) || "\u00A0"
      ci++
      if (ci > line.length) {
        li++
        ci = 0
        timer = setTimeout(tick, li < lines.length ? 120 : 0)
      } else {
        timer = setTimeout(tick, speed)
      }
    }
    timer = setTimeout(tick, 250)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { containerRef, done }
}

function TerminalFrame({
  title,
  children,
  footer,
}: {
  title: string
  children: React.ReactNode
  footer: string
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-2 sm:p-5">
      <div className="flex h-[min(90vh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-emerald-900/60 bg-[#020602] shadow-[0_0_60px_rgba(16,185,129,0.12)]">
        {/* Title bar — Linux terminal tab */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-emerald-900/50 bg-[#04120a] px-3 select-none">
          <div className="flex items-center gap-2.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-emerald-800 text-[9px] font-bold text-emerald-100">
              &gt;_
            </span>
            <span className="font-mono text-[11.5px] text-emerald-500">{title}</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px] text-emerald-800">
            <span className="hover:text-emerald-400">—</span>
            <span className="hover:text-emerald-400">□</span>
            <span className="hover:text-red-400">✕</span>
          </div>
        </div>

        {/* Screen */}
        <div className="flex-1 overflow-y-auto px-4 py-4 font-mono text-[13.5px] leading-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-emerald-900/60">
          {children}
        </div>

        {/* Status bar */}
        <div className="flex h-7 shrink-0 items-center justify-between border-t border-emerald-900/50 bg-[#04120a] px-3 font-mono text-[10px] text-emerald-700">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-500" />
            {footer}
          </span>
          <span>PBKDF2-SHA256 · 150k · HttpOnly session</span>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────── LOCK SCREEN ────────────────────────── */

function LockScreen({
  username,
  onAuth,
}: {
  username: string
  onAuth: () => void
}) {
  const { containerRef, done } = useTypewriter(
    [
      "Welcome back to JARVIS",
      "",
      "Secure terminal established. Identity: " + username,
    ],
    16,
    "text-[17px] font-bold tracking-wide text-emerald-300"
  )
  const [value, setValue] = React.useState("")
  const [lines, setLines] = React.useState<Line[]>([])
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const attemptsRef = React.useRef(0)

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    if (done && !busy) inputRef.current?.focus()
  }, [lines, done, busy])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !done) return
    const pwd = value
    setValue("")

    if (pwd.trim().toLowerCase() === "help") {
      setLines((p) => [
        ...p,
        { text: "Commands: (type your password to unlock) · forgot · exit", cls: "dim" },
      ])
      return
    }
    if (pwd.trim().toLowerCase() === "forgot") {
      setLines((p) => [
        ...p,
        {
          text:
            "Your password is stored only as a salted PBKDF2 hash — it cannot be revealed. " +
            "If forgotten, sign out and create a new account, or ask the administrator to reset it.",
          cls: "dim",
        },
      ])
      return
    }
    if (pwd.trim().toLowerCase() === "exit") {
      setLines((p) => [...p, { text: "There is no escape. Enter your password.", cls: "err" }])
      return
    }
    if (!pwd) return

    setBusy(true)
    setLines((p) => [
      ...p,
      { text: `${username}@jarvis:~$ ${"•".repeat(Math.min(pwd.length, 16))}`, cls: "white" },
    ])
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      })
      if (res.ok) {
        attemptsRef.current = 0
        setLines((p) => [
          ...p,
          { text: "Authentication successful.", cls: "ok" },
          { text: "Initializing JARVIS...", cls: "accent" },
        ])
        setTimeout(onAuth, 750)
        return
      }
      attemptsRef.current += 1
      const n = attemptsRef.current
      setLines((p) => [
        ...p,
        { text: "Access denied. Incorrect password.", cls: "err" },
        ...(n >= 3
          ? [
              {
                text: `Attempt ${n} recorded. Account locks temporarily after repeated failures.`,
                cls: "dim" as const,
              },
            ]
          : []),
      ])
    } catch {
      setLines((p) => [
        ...p,
        { text: "Cannot reach the authentication server. Try again.", cls: "err" },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <TerminalFrame title={`${username}@jarvis: ~`} footer={busy ? "verifying…" : "terminal ready — locked"}>
      <div ref={scrollRef} className="flex h-full flex-col" onClick={() => inputRef.current?.focus()}>
        {/* Banner */}
        <pre className="mb-3 select-none text-[11px] leading-4 text-emerald-600">
{String.raw`╔══════════════════════════════════════════════╗`}
{String.raw`║   J A R V I S  —  PERSONAL AI SYSTEM  v0.5   ║`}
{String.raw`╚══════════════════════════════════════════════╝`}
        </pre>

        {/* Typed welcome — printed imperatively (like a real terminal) */}
        <div className="mb-1">
          <div ref={containerRef} className="inline-block space-y-0.5 align-top" />
          {!done && (
            <span className="inline-block h-4 w-2 animate-pulse-soft bg-emerald-500/80 align-middle" />
          )}
        </div>

        {/* Previous attempts / messages */}
        <div className="space-y-0.5">
          {lines.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap ${l.cls ? CLASSES[l.cls] : "text-emerald-200"}`}>
              {l.text}
            </div>
          ))}
        </div>

        {/* Live prompt — zeeshan@jarvis:~$ Enter your Jarvis password: */}
        {done && (
          <form onSubmit={submit} className="mt-1 flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-emerald-400">
              <span className="text-emerald-200">{username}@jarvis</span>
              <span className="text-emerald-600">:~$</span>
            </span>
            <span className="shrink-0 text-emerald-500">Enter your Jarvis password:</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type="password"
              autoFocus
              disabled={busy}
              autoComplete="off"
              aria-label="Jarvis password"
              className="min-w-[120px] flex-1 border-none bg-transparent font-mono text-[13.5px] tracking-widest text-emerald-100 caret-emerald-400 outline-none disabled:opacity-40"
            />
          </form>
        )}
        {done && (
          <div className="mt-3 text-[11px] text-emerald-800">
            Press ENTER to unlock · type “forgot” if you lost your password
          </div>
        )}
      </div>
    </TerminalFrame>
  )
}

/* ────────────────────────── GATE SCREEN ────────────────────────── */

function GateScreen({ onAuth }: { onAuth: () => void }) {
  const { containerRef, done } = useTypewriter([
    "JARVIS OS [Version 0.5.0] — secure account gateway",
    "No active session on this device.",
    "",
  ])
  const [tab, setTab] = React.useState<"register" | "login">("register")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const emailRef = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => {
    if (done) emailRef.current?.focus()
  }, [done])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError("")

    const mail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) {
      setError("Enter a valid Gmail address.")
      return
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }

    setBusy(true)
    try {
      if (tab === "register") {
        if (password !== confirm) {
          setError("Passwords do not match.")
          setBusy(false)
          return
        }
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: usernameFromEmail(mail),
            email: mail,
            password,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error ?? "Could not create the account.")
          setBusy(false)
          return
        }
        onAuth()
      } else {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identity: mail, password }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error ?? "Authentication failed.")
          setBusy(false)
          return
        }
        onAuth()
      }
    } catch {
      setError("Cannot reach the authentication server.")
      setBusy(false)
    }
  }

  return (
    <TerminalFrame title="jarvis@setup: ~" footer={busy ? "working…" : "secure channel ready"}>
      <pre className="mb-3 select-none text-[11px] leading-4 text-emerald-600">
{String.raw`╔══════════════════════════════════════════════╗`}
{String.raw`║   J A R V I S  —  PERSONAL AI SYSTEM  v0.5   ║`}
{String.raw`╚══════════════════════════════════════════════╝`}
      </pre>

      {/* Typed boot lines — printed imperatively (like a real terminal) */}
      <div className="mb-1">
        <div ref={containerRef} className="inline-block space-y-0.5 align-top" />
        {!done && (
          <span className="inline-block h-4 w-2 animate-pulse-soft bg-emerald-500/80 align-middle" />
        )}
      </div>

      {done && (
        <form onSubmit={submit} className="mt-3 max-w-md space-y-3">
          {/* Tab switch — like terminal sub-commands */}
          <div className="flex gap-4 text-[12.5px]">
            {(["register", "login"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t)
                  setError("")
                }}
                className={`font-mono transition ${
                  tab === t
                    ? "text-emerald-300 underline underline-offset-4"
                    : "text-emerald-800 hover:text-emerald-500"
                }`}
              >
                {t === "register" ? "create account" : "sign in"}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-emerald-500">Gmail:</span>
            <input
              ref={emailRef}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoFocus
              spellCheck={false}
              autoComplete="email"
              disabled={busy}
              placeholder="you@gmail.com"
              className="min-w-0 flex-1 border-b border-emerald-900/70 bg-transparent px-1 py-1 font-mono text-[13.5px] text-emerald-100 caret-emerald-400 outline-none placeholder:text-emerald-900 focus:border-emerald-500"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-emerald-500">Password:</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={tab === "register" ? "new-password" : "current-password"}
              disabled={busy}
              placeholder="min 8 characters"
              className="min-w-0 flex-1 border-b border-emerald-900/70 bg-transparent px-1 py-1 font-mono text-[13.5px] tracking-widest text-emerald-100 caret-emerald-400 outline-none placeholder:text-emerald-900 focus:border-emerald-500"
            />
          </label>

          {tab === "register" && (
            <label className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-emerald-500">Confirm:</span>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                autoComplete="new-password"
                disabled={busy}
                placeholder="repeat password"
                className="min-w-0 flex-1 border-b border-emerald-900/70 bg-transparent px-1 py-1 font-mono text-[13.5px] tracking-widest text-emerald-100 caret-emerald-400 outline-none placeholder:text-emerald-900 focus:border-emerald-500"
              />
            </label>
          )}

          {error && (
            <div className="whitespace-pre-wrap text-[12.5px] text-red-400">⚠ {error}</div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="rounded border border-emerald-700 bg-emerald-950 px-4 py-1.5 font-mono text-[13px] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-900 disabled:opacity-50"
            >
              {busy
                ? "working…"
                : tab === "register"
                  ? "create account →"
                  : "sign in →"}
            </button>
            <span className="text-[11px] text-emerald-800">or press ENTER</span>
          </div>

          <div className="pt-2 text-[11px] leading-5 text-emerald-800">
            {tab === "register"
              ? "First time? Your Gmail + password create the account. Passwords are salted + hashed (PBKDF2) — never stored in plain text."
              : "Returning? Sign in once — afterwards JARVIS asks only for your password at every launch."}
          </div>
        </form>
      )}
    </TerminalFrame>
  )
}

/* ────────────────────────── COMPONENT ────────────────────────── */

export default function LoginTerminal({
  mode,
  username,
  onAuth,
}: {
  mode: Mode
  /** Known account name for the lock prompt (from the session cookie). */
  username?: string
  onAuth: () => void
}) {
  if (mode === "lock" && username) {
    return <LockScreen username={username} onAuth={onAuth} />
  }
  return <GateScreen onAuth={onAuth} />
}
