"use client"

import type { CommandIntent } from "@/lib/commands"

/**
 * A local command reply — JARVIS's terminal-style acknowledgement.
 * Rendered as a compact card, never as streaming markdown.
 */
export default function CommandCard({ m, intent }: { m: { content: string }; intent: CommandIntent }) {
  const icon =
    intent.kind === "files"
      ? "📁"
      : intent.kind === "history"
        ? "🗂"
        : intent.kind === "clear"
          ? "🧹"
          : intent.kind === "logout"
            ? "🔒"
            : intent.kind === "voice-on"
              ? "🔊"
              : intent.kind === "voice-off"
                ? "🔇"
                : "⏹"

  return (
    <div className="flex gap-3 animate-fade-up">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc/40 bg-arc/10 text-xs font-bold text-arc-bright">
        J
      </div>
      <div className="min-w-0 flex-1">
        <div className="inline-flex items-start gap-2 rounded-xl border border-edge bg-panel/70 px-3.5 py-2.5 text-[13.5px] leading-6 text-slate-400">
          <span className="text-sm leading-6">{icon}</span>
          <span className="whitespace-pre-wrap">{m.content}</span>
        </div>
      </div>
    </div>
  )
}
