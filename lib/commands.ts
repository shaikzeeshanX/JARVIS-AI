"use client"

/**
 * Local voice commands — the "Linux shell" of JARVIS.
 *
 * These never reach the AI: JARVIS understands them itself, like a terminal
 * builtin. Everything else falls through to the conversation engine.
 *
 *   STOP      stop / quit / end / break / halt / cancel / silence / cancel that
 *   VOICE     mute / unmute / voice off / voice on / be quiet / talk to me
 *   HISTORY   show history / open chat history / show me our chat sessions
 *   FILES     upload files / choose files / open the file picker / attach documents
 *   CLEAR     clear conversation / start over / reset the chat
 *
 * Phrase lists can grow here without touching any UI code.
 */

export type CommandKind =
  | "stop"
  | "voice-on"
  | "voice-off"
  | "history"
  | "files"
  | "library"
  | "clear"
  | "logout"

export interface CommandIntent {
  kind: CommandKind
  /** JARVIS's spoken reply. Null = stay silent (e.g. stopping mid-speech). */
  say: string | null
  /** Render as a local command card instead of streaming markdown. */
  card?: boolean
}

interface Rule {
  kind: CommandKind
  patterns: RegExp[]
}

const RULES: Rule[] = [
  {
    kind: "stop",
    patterns: [
      /^(please |just |okay |ok )?(stop|quit|end|halt|break|abort|cancel)( it| this| that| now| please| everything| the (chat|conversation|answer|voice|music))?( already)?[.!?]*$/i,
      /^(cancel|stop|abort) (that|this|it|everything|the (answer|reply|response|music|voice))[.!?]*$/i,
      /^(that'?s enough|enough|silence|lay off|never ?mind|scratch that|forget it)[.!?]*$/i,
      /^exit[.!?]*$/i,
    ],
  },
  {
    kind: "voice-on",
    patterns: [
      /^(turn|switch|put) (the )?(voice|sound|speech|speaking|audio)( on| back on)?[.!?]*$/i,
      /^(voice|sound|speech|speaking) (on|back on)[.!?]*$/i,
      /^(can you )?(talk|speak|be vocal)( to me)? again[.!?]*$/i,
      /^(unmute|resume (the )?(voice|speech|audio)|start speaking|be vocal)[.!?]*$/i,
    ],
  },
  {
    kind: "voice-off",
    patterns: [
      /^(turn|switch|put) (the )?(voice|sound|speech|speaking|audio)( off| down)[.!?]*$/i,
      /^(voice|sound|speech|speaking) (off|down)[.!?]*$/i,
      /^(be quiet|shut up|stop talking|stop speaking|quiet now|no more talking|muzzle yourself)[.!?]*$/i,
      /^(mute|unplug (the )?(mic|voice)|go silent)[.!?]*$/i,
    ],
  },
  {
    kind: "history",
    patterns: [
      // A "show" verb + a history noun + chat context (lookaheads keep
      // "history of ancient rome" out of JARVIS's conversation log).
      /^(?=.*\b(history|transcripts?|logs?|sessions?)\b)(?=.*\b(chat|conversation|session|dialogue|previous|past|our|talks|discussion|threads)\b)(show|open|display|pull up|bring up|view|get me|give me)( me)?(.*)$/i,
      /^(what|which) (are|were|was)( all| the)?( of)?( our| my)?( previous| past| old)?( chats| conversations| sessions)( so far)?[.?]*$/i,
      /^(chat|conversation|session) (history|transcripts?|log|logs)[.!?]*$/i,
      /^show (me )?(my |our )?(chat |conversation |session )?(history|sessions?)[.!?]*$/i,
    ],
  },
  {
    kind: "files",
    patterns: [
      /^(upload|attach|import|add)( me)?( some| my| the| these)?( document| file| docs?| files?| pdf| papers?)s?$/i,
      /^(upload|attach|import|add)( me)?( some| my| the| these)?( document| file| docs?| files?| pdf| papers?)s? (to|into|in|onto|to you)( jarvis| you| it)?$/i,
      /^(i )?(want|need|would like|'d like) to (give|hand|upload|attach|add|share) (you |jarvis )?(some |my |the )?(files?|documents?|docs?|pdfs?|papers?)[.!?]*$/i,
      /^(choose|select|pick|open|load)( me)?( some| my| the)?( file| document| docs?| files?| pdf)s?$/i,
      /^(open|show|launch|bring up|start)( the )?(file|document|upload)( picker| chooser| dialog| window| panel)s?[.!?]*$/i,
      /^(file|document|upload)( picker| chooser| dialog)s?[.!?]*$/i,
      /^(give you|hand you|share)( my)?( files?| documents?| docs?| pdfs?)[.!?]*$/i,
      /^(let me )?(give|send|hand|share)( you)?( some| my| the)?( files?| documents?| docs?| pdfs?)[.!?]*$/i,
      /^(upload|attach|add|import) (these|those|them|everything)( files?)?[.!?]*$/i,
      /^(upload|attach|add|import|open) (a |the |some )?file[.!?]*$/i,
    ],
  },
  {
    kind: "library",
    patterns: [
      /^(show|open|display|pull up|bring up|list)( me)?( my| our| the)?( knowledge| document| file| library| uploaded)?( base| docs?| files?| documents?| library| papers?| pdfs?)( panel| list| view)?( now)?[.!?]*$/i,
      /^(what|which) (files?|documents?|docs?|pdfs?|papers?) (did i|have i|have you|are there|is there)\s?(uploaded|upload|added|add|stored|store[ds]?|given you|shared|in you)?[.?]*$/i,
      /^(what|which) (files?|documents?|docs?|pdfs?) (are|is|do i have|can you see) (in|inside|within|stored in|saved in) (my|the|our) (knowledge base|library|store|archive|uploads)[.?]*$/i,
      /^(what'?s|whats) (in|inside) (my|the|our) (knowledge base|library|store|archive|uploads?)[.?]*$/i,
      /^(open|show)( the)?( knowledge base| library| document (list|store))[.!?]*$/i,
      /^my (knowledge base|library|documents|files|uploads)[.!?]*$/i,
    ],
  },
  {
    kind: "clear",
    patterns: [
      /^(clear|wipe|erase|delete)( the| this| our| my)?( chat| conversation| session| history)?( please)?[.!?]*$/i,
      /^(start over|start again|begin again|start from scratch|start from (the )?beginning|fresh start|from scratch)( please)?[.!?]*$/i,
      /^reset (the |this )?(chat|conversation|session|history)[.!?]*$/i,
      /^(new|fresh) (chat|conversation|session)( please)?[.!?]*$/i,
    ],
  },
  {
    kind: "logout",
    patterns: [
      /^(log ?out|sign ?out|sign off|logoff)( of (jarvis|it|this)?| from (jarvis|it)?| my (account|session))?( please| now)?[.!?]*$/i,
      /^(lock (the )?(session|jarvis|it)|end my session|close my account)( please)?[.!?]*$/i,
    ],
  },
]

/** Detect a local command. Returns null when JARVIS should just converse. */
export function detectCommand(text: string): CommandIntent | null {
  const t = text.trim()
  if (!t || t.length > 120) return null

  for (const rule of RULES) {
    for (const re of rule.patterns) {
      if (!re.test(t)) continue
      switch (rule.kind) {
        case "stop":
          return { kind: "stop", say: "Stopped.", card: true }
        case "voice-on":
          return { kind: "voice-on", say: "Voice on. I'm listening.", card: true }
        case "voice-off":
          return { kind: "voice-off", say: "Voice off. I'll keep it quiet from here.", card: true }
        case "clear":
          return { kind: "clear", say: "Conversation cleared. A fresh session, sir.", card: true }
        case "files":
          return {
            kind: "files",
            say: "Opening the file picker. Choose the files you'd like me to learn.",
            card: true,
          }
        case "history": {
          return { kind: "history", say: "", card: true } // say filled in by the app (needs the list)
        }
        case "library": {
          return { kind: "library", say: "", card: true } // say filled in by the app (needs the library)
        }
        case "logout": {
          return { kind: "logout", say: "Signing out. Locking the session, sir.", card: true }
        }
      }
    }
  }
  return null
}
