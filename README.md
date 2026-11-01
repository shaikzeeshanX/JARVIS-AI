# 🚀 JARVIS — Your Personal AI Assistant

ChatGPT + Perplexity, personalised, with voice — built as a web app.

**Live target:** `jarvis.adreesumer.com`

---

## Phase 4 — Voice OS (current) ✅

JARVIS is now a **voice-first, Linux-style interface**: there are no upload
buttons, no history shortcuts, no research toggles in the UI. You *tell*
JARVIS what to do, and it does it — speaking every reply.

| Voice command | What JARVIS does |
| --- | --- |
| “choose files” / “upload the documents” / “give you my files” | Opens the native file picker **for you**, then reads back what it learned |
| “show history” / “open chat history” / “show me our chat sessions” | Opens the sidebar and **speaks** your conversation list |
| “show my knowledge base” / “what files did i upload” | Opens the library and lists your documents |
| “stop” / “quit” / “end” / “break” / “cancel that” | Halts speech **and** generation mid-reply |
| “voice off” / “mute” / “be quiet” | JARVIS goes silent (still listens) |
| “voice on” / “unmute” / “talk to me” | JARVIS starts speaking again |
| “clear the chat” / “start over” | Fresh session |
| Anything else | Full conversation with documents + live web research |

| Capability | Status |
| --- | --- |
| Sentence-by-sentence speech — JARVIS talks **while** it answers | ✅ |
| All 46 command phrases unit-tested | ✅ |
| Document uploads — PDF · DOCX · TXT · MD · CSV · JSON (voice-only) | ✅ |
| Private knowledge base (IndexedDB, excerpts-only egress) | ✅ |
| Live web research with clickable citations | ✅ |
| Conversation history — voice-opened, private, per-browser | ✅ |
| Demo Mode — full functionality without an API key | ✅ |
| Giant breathing JARVIS orb (empty screen) | ✅ |

**Roadmap:** Phase 5 — Supabase accounts, cloud sync, deploy to jarvis.adreesumer.com, mobile + desktop.

---

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000

### Add your AI key (optional — Demo Mode works without it)

1. Copy `.env.example` to `.env.local`
2. Add `OPENAI_API_KEY=sk-...`
3. Restart `npm run dev`

The key stays **server-side only** (in `app/api/chat/route.ts`) and is never sent to the browser.

---

## How it fits together

```
app/page.tsx              Voice OS: command routing, streaming speech, picker flow
app/api/chat/route.ts     The brain: knowledge + research → OpenAI stream (or Demo Mode)
app/api/parse/route.ts    File → text extraction (PDF via unpdf, DOCX via mammoth)
components/               Sidebar · ChatView · MessageInput · KnowledgePanel · CommandCard
lib/commands.ts           Voice commands — stop, quit, files, history, library, clear, mute
lib/chunk.ts              Chunking + keyword retrieval (browser-side, privacy-first)
lib/db.ts                 Knowledge base storage — IndexedDB, device-local only
lib/search.ts             Live web search: Tavily (optional) → Google News → Wikipedia
lib/speech.ts             TTS with sentence-streaming + speech-to-text (Web Speech API)
lib/store.ts              Conversation persistence (localStorage → Supabase later)
```

### How personal intelligence works (Phase 3)

1. You upload a file (or save a note) → text is extracted **in your browser's library**
2. When you ask a question, the library is searched **client-side**
3. Only the top excerpts (≤4) travel with your question — never whole files
4. JARVIS answers personally, citing your documents by name

### Research providers (Phase 2)

| Provider | Cost | Needs key | Best for |
| --- | --- | --- | --- |
| Tavily | free tier | `TAVILY_API_KEY` | broadest web coverage |
| Google News RSS | free | no | current events, recency |
| Wikipedia API | free | no | topics, people, technology |

Without a key, JARVIS automatically uses the free providers — citations work in Demo Mode too. Add Tavily later for deeper web coverage.

### Upgrading the brain

| Want | Change |
| --- | --- |
| Smarter model | `OPENAI_MODEL=gpt-4o` in `.env.local` |
| Deeper web search | Add `TAVILY_API_KEY` in `.env.local` |
| Document answers (Phase 3) | Retrieve matching chunks, prepend to the prompt |

---

## Voice notes

- Uses the free built-in **Web Speech API** — no API cost.
- Chrome / Edge / Safari supported; Firefox has no speech recognition (mic hides automatically).
- Toggle with **🔊 Voice ON** in the top bar, or stop any speech by clicking it mid-sentence.
