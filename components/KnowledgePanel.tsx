"use client"

import * as React from "react"
import { allDocs, deleteDoc, putDoc, uid, type DocRecord } from "@/lib/db"
import { chunkText, retrieve } from "@/lib/chunk"

/**
 * The Knowledge Center — JARVIS's private library.
 * Upload documents, save notes, test retrieval, delete anything.
 */

export default function KnowledgePanel({
  open,
  onClose,
  uploading,
  count,
  onCountChange,
}: {
  open: boolean
  onClose: () => void
  uploading: boolean
  count: number
  onCountChange: (count: number) => void
}) {
  const [docs, setDocs] = React.useState<DocRecord[]>([])
  const [note, setNote] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<Array<{ doc: string; text: string }>>([])

  const refresh = React.useCallback(async () => {
    const all = await allDocs()
    setDocs(all)
    onCountChange(all.length)
  }, [onCountChange])

  React.useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const remove = async (id: string) => {
    await deleteDoc(id)
    void refresh()
  }

  const saveNote = async () => {
    const text = note.trim()
    if (!text) return
    await putDoc({
      id: uid(),
      name: `Note · ${new Date().toLocaleDateString()}`,
      kind: "note",
      chars: text.length,
      text,
      createdAt: Date.now(),
    })
    setNote("")
    void refresh()
  }

  const testSearch = () => {
    const q = query.trim()
    if (!q || docs.length === 0) {
      setResults([])
      return
    }
    setResults(
      retrieve(q, docs.map((d) => ({ name: d.name, text: d.text })), 3, 1500)
    )
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="relative flex h-full w-full max-w-[380px] flex-col border-l border-edge bg-panel shadow-2xl animate-fade-up">
        <header className="flex items-center justify-between border-b border-edge px-4 py-3.5">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-slate-100">
              📚 Knowledge Base
            </h2>
            <p className="text-[11px] text-slate-500">
              Private · stored in this browser only
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-edge/50 hover:text-slate-200"
            aria-label="Close knowledge base"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Voice-only intake — no buttons, JARVIS opens the picker */}
          <div className="rounded-xl border border-dashed border-arc/30 bg-arc/5 px-4 py-3 text-center text-[12px] leading-5 text-arc-bright/90">
            🎤 Say <span className="font-semibold">“choose files”</span> and
            I'll open the picker for you.
            {uploading && <span className="ml-1 animate-pulse-soft">⏳ reading…</span>}
          </div>

          {/* Quick note */}
          <div className="rounded-xl border border-edge bg-void/40 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Quick memory
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. I prefer concise answers with bullet points."
              className="w-full resize-none rounded-lg border border-edge bg-transparent px-2.5 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-arc/40 focus:outline-none"
            />
            <button
              onClick={saveNote}
              disabled={!note.trim()}
              className="mt-2 w-full rounded-lg bg-arc px-3 py-2 text-xs font-semibold text-void transition hover:bg-arc-bright disabled:bg-edge disabled:text-slate-600"
            >
              Remember this
            </button>
          </div>

          {/* Test retrieval */}
          <div className="rounded-xl border border-edge bg-void/40 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Test a question
            </div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && testSearch()}
                placeholder="What would JARVIS find?"
                className="min-w-0 flex-1 rounded-lg border border-edge bg-transparent px-2.5 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-arc/40 focus:outline-none"
              />
              <button
                onClick={testSearch}
                className="rounded-lg border border-edge px-3 text-xs text-slate-400 transition hover:border-arc/40 hover:text-arc-bright"
              >
                Find
              </button>
            </div>
            {results.length > 0 && (
              <div className="mt-3 space-y-2">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-edge bg-panel/60 p-2.5"
                  >
                    <div className="mb-1 text-[10px] font-medium text-arc-bright">
                      📄 {r.doc}
                    </div>
                    <p className="line-clamp-3 text-[11px] leading-4 text-slate-500">
                      {r.text.slice(0, 220)}…
                    </p>
                  </div>
                ))}
              </div>
            )}
            {query.trim() && results.length === 0 && docs.length > 0 && (
              <p className="mt-3 text-[11px] text-slate-600">
                No matching excerpts — try different wording.
              </p>
            )}
          </div>

          {/* Library */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Library ({docs.length})
            </div>
            {docs.length === 0 && (
              <p className="rounded-xl border border-dashed border-edge p-4 text-center text-[12px] text-slate-600">
                Empty. Say “choose files” and pick a project file, notes or a
                PDF — I'll answer questions straight from them.
              </p>
            )}
            <div className="space-y-2">
              {docs.map((d) => (
                <div
                  key={d.id}
                  className="group flex items-start gap-2 rounded-lg border border-edge bg-panel/60 px-3 py-2.5"
                >
                  <span className="mt-0.5 text-sm">
                    {d.kind === "note" ? "📝" : "📄"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-slate-300">
                      {d.name}
                    </div>
                    <div className="text-[10px] text-slate-600">
                      {d.chars.toLocaleString()} characters ·{" "}
                      {chunkText(d.text).length} chunks ·{" "}
                      {new Date(d.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => remove(d.id)}
                    aria-label={`Delete ${d.name}`}
                    className="hidden rounded p-1 text-slate-600 transition hover:text-red-400 group-hover:block"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="border-t border-edge px-4 py-3 text-[10.5px] leading-4 text-slate-600">
          🔒 Only relevant excerpts are sent with each question — your full
          documents never leave this device.
        </footer>
      </aside>
    </div>
  )
}
