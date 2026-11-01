"use client"

import type { Conversation } from "@/lib/types"

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Sidebar({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDelete,
  collapsed,
}: {
  conversations: Conversation[]
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  collapsed: boolean
}) {
  return (
    <aside
      className={`${
        collapsed ? "w-0 -ml-px" : "w-72"
      } flex h-full shrink-0 flex-col border-r border-edge bg-panel/70 backdrop-blur transition-all duration-300 overflow-hidden`}
    >
      <div className="p-4">
        <button
          onClick={onNew}
          className="group flex w-full items-center justify-between rounded-xl border border-arc/30 bg-arc/10 px-4 py-3 text-sm font-medium text-arc-bright transition hover:border-arc/60 hover:bg-arc/20 hover:shadow-glow"
        >
          <span className="flex items-center gap-2">
            <span className="text-lg leading-none">＋</span> New chat
          </span>
          <kbd className="rounded border border-edge bg-void px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            Ctrl K
          </kbd>
        </button>
      </div>

      <div className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        History
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {conversations.length === 0 && (
          <p className="px-3 py-6 text-sm text-slate-600">
            No conversations yet. Ask me anything to begin.
          </p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
              c.id === activeId
                ? "border border-arc/30 bg-arc/10 text-slate-100"
                : "border border-transparent text-slate-400 hover:bg-edge/40 hover:text-slate-200"
            }`}
          >
            <span className="flex-1 truncate">{c.title}</span>
            <span className="hidden shrink-0 text-[10px] text-slate-600 group-hover:block">
              {timeAgo(c.updatedAt)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(c.id)
              }}
              aria-label="Delete conversation"
              className="hidden shrink-0 rounded p-1 text-slate-600 hover:text-red-400 group-hover:block"
            >
              ✕
            </button>
          </div>
        ))}
      </nav>

      <div className="border-t border-edge p-4 text-[11px] leading-5 text-slate-600">
        <span className="mr-1">🔒</span>
        Phase 3 · your documents and notes live in this browser only — excerpts
        travel with your questions, never whole files.
      </div>
    </aside>
  )
}
