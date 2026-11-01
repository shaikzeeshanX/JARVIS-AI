"use client"

import type { Conversation } from "./types"

/**
 * Phase 1 storage: conversations live in localStorage so JARVIS remembers
 * history on this device with zero backend. Phase 3 swaps this for Supabase
 * (same function signatures, cloud-synced + private per account).
 */

const KEY = "jarvis.conversations.v1"

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Conversation[]) : []
  } catch {
    return []
  }
}

export function saveConversations(conversations: Conversation[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(conversations))
  } catch {
    // Storage full / private mode — history just won't persist.
  }
}

export function newConversation(): Conversation {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: "New conversation",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** A readable title taken from the first user message. */
export function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ")
  if (!clean) return "New conversation"
  return clean.length > 42 ? clean.slice(0, 42) + "…" : clean
}

export function uid(): string {
  return crypto.randomUUID()
}
