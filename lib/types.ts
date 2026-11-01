export type Role = "user" | "assistant"

export interface Source {
  title: string
  url: string
  snippet: string
}

export interface Message {
  id: string
  role: Role
  content: string
  createdAt: number
  /** Live sources backing this reply (research mode). */
  sources?: Source[]
  /** Names of the user's own documents that informed this reply. */
  docs?: string[]
  /** Set when this "reply" is a local command (files, history, stop…). */
  intent?: CommandIntentKind
}

/** Mirrors lib/commands.ts CommandIntent.kind — kept as a plain string union
 *  so messages stay JSON-serializable for localStorage. */
export type CommandIntentKind =
  | "stop"
  | "voice-on"
  | "voice-off"
  | "history"
  | "files"
  | "library"
  | "clear"
  | "logout"

/** A relevant excerpt retrieved from the user's knowledge base. */
export interface DocExcerpt {
  doc: string
  text: string
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}
