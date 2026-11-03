"use client"

import * as React from "react"
import type { CommandIntent } from "@/lib/commands"
import type { Message, Source } from "@/lib/types"
import Markdown from "./Markdown"
import JarvisOrb from "@/components/JarvisOrb"
import CommandCard from "@/components/CommandCard"

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function SourceChips({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {sources.map((s, i) => (
        <a
          key={i}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={s.snippet || s.url}
          className="group flex max-w-[260px] items-center gap-2 rounded-lg border border-edge bg-panel/70 px-2.5 py-1.5 text-[11px] transition hover:border-arc/40 hover:bg-arc/5"
        >
          <span className="shrink-0 font-mono font-semibold text-arc-bright">
            [{i + 1}]
          </span>
          <span className="truncate text-slate-400 group-hover:text-slate-200">
            {s.title}
          </span>
          <span className="shrink-0 text-slate-600">{domainOf(s.url)}</span>
        </a>
      ))}
    </div>
  )
}

function DocChips({ docs }: { docs: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-slate-600">
        from your library
      </span>
      {docs.map((d) => (
        <span
          key={d}
          className="max-w-[200px] truncate rounded-md border border-arc/30 bg-arc/10 px-2 py-0.5 text-[11px] text-arc-bright"
          title={d}
        >
          📄 {d}
        </span>
      ))}
    </div>
  )
}

function CommandCardView({ m }: { m: Message }) {
  const intent: CommandIntent = { kind: m.intent as any, say: m.content, card: true }
  return <CommandCard m={m} intent={intent} />
}

function Bubble({ m }: { m: Message }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-arc/30 bg-arc/15 px-4 py-3 text-[15px] leading-7 text-slate-100">
          {m.content}
        </div>
      </div>
    )
  }
  if (m.intent) return <CommandCardView m={m} />
  return (
    <div className="flex gap-3 animate-fade-up">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc/40 bg-arc/10 text-xs font-bold text-arc-bright">
        J
      </div>
      <div className="min-w-0 max-w-[92%] flex-1">
        <Markdown>{m.content}</Markdown>
        {m.docs && m.docs.length > 0 && <DocChips docs={m.docs} />}
        {m.sources && m.sources.length > 0 && (
          <SourceChips sources={m.sources} />
        )}
      </div>
    </div>
  )
}

export default function ChatView({
  messages,
  busy,
  split = false,
}: {
  messages: Message[]
  busy: boolean
  /** Voice presence mode: conversation pinned left, JARVIS's cube holds
   *  the right side of the screen (a bit less than half). */
  split?: boolean
}) {
  const endRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, busy])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="aspect-square w-[min(78vh,620px)] max-w-full">
          <JarvisOrb fill busy={busy} />
        </div>
      </div>
    )
  }

  const bubbles = (
    <>
      {messages.map((m) => (
        <Bubble key={m.id} m={m} />
      ))}
      {busy && (
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-arc/40 bg-arc/10">
            <span className="h-2 w-2 animate-pulse-soft rounded-full bg-arc-bright" />
          </div>
          <span className="animate-pulse-soft">JARVIS is thinking…</span>
        </div>
      )}
      <div ref={endRef} />
    </>
  )

  // ── Voice presence mode ───────────────────────────────────
  // Conversation on the left, JARVIS breathing on the right (44% width),
  // while the input bar below stays centered as always.
  if (split) {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mr-auto w-full max-w-2xl space-y-6 px-5 py-8 lg:pl-10">
            {bubbles}
          </div>
        </div>
        <aside className="hidden w-[44%] max-w-[620px] shrink-0 items-center justify-center overflow-hidden border-l border-edge bg-void/40 lg:flex">
          {/* Same wrapper as the empty screen, so the cube is framed identically
           *  and never spills past the column. */}
          <div className="aspect-square w-[min(78vh,620px)] max-w-full">
            <JarvisOrb fill busy={busy} />
          </div>
        </aside>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        {bubbles}
      </div>
    </div>
  )
}
