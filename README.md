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
| Local AI via Ollama — real answers, no API key, no cloud | ✅ |
| Giant breathing JARVIS orb (empty screen) | ✅ |

**Roadmap:** Phase 5 — Supabase accounts, cloud sync, deploy to jarvis.adreesumer.com, mobile + desktop.

---

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000

### AI engine — local Ollama by default

JARVIS answers with a **real model running on your machine** through
[Ollama](https://ollama.com). There is no Demo Mode and no canned replies.

```bash
# once
ollama pull llama3.2
ollama serve          # or just launch the Ollama app

npm run dev
```

`lib/ai.ts` connects to `http://127.0.0.1:11434` and streams the answer into
`/api/chat`, exactly like the OpenAI path — no API key, no billing and no
internet needed for inference.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | where Ollama listens |
| `OLLAMA_MODEL` | `llama3.2` | model tag to use |
| `JARVIS_AI_PROVIDER` | `auto` | `ollama`, `openai`, or `auto` |
| `OPENAI_API_KEY` | — | optional cloud fallback in `auto` mode |
| `OPENAI_MODEL` | `gpt-4o-mini` | cloud model |

The top bar shows **LOCAL AI · OLLAMA** when the local engine is answering. If
Ollama is down or the model is missing, the reply says so and the status turns
red **AI OFFLINE** — JARVIS never fakes an answer. Keys stay **server-side only**
and are never sent to the browser.

> **Deploying to Vercel?** Ollama only runs on your own computer, so a hosted
> server cannot reach it. Set `JARVIS_AI_PROVIDER=openai` with `OPENAI_API_KEY`
> in the Vercel project, or the hosted chat will correctly report AI OFFLINE.

---

## Phase 5 — Secure account system (current) ✅

Every launch of JARVIS opens on a **Linux-style lock terminal** — your
account password is required on *every fresh open*, verified **by the server**.

| Screen | When | What it asks |
| --- | --- | --- |
| **Account gate** | No session (first time / signed out) | Gmail + Password + **Confirm password** → creates the account (or Gmail + Password to sign in) |
| **Lock terminal** | Session exists — every fresh open | `Welcome back to JARVIS` → `you@jarvis:~$ Enter your Jarvis password:` (masked) |

**Correct password** → `Authentication successful.` / `Initializing JARVIS...` → dashboard.
**Wrong password** → `Access denied. Incorrect password.` → retry (never reveals the real one; type `forgot` for the recovery note).

### Security model

- Passwords: **PBKDF2-SHA256, 150k iterations, random salt** — never plain text
- Sessions: **HMAC-signed HttpOnly cookie** (7 days, `AUTH_SECRET`) — token never readable by frontend JS
- Passwords are **never** stored in localStorage, sessionStorage, or env vars
- `/api/auth/unlock` re-verifies the password against the stored hash on every open
- All chat/memory endpoints return **401** without a valid session
- Sign out: say **“log out”** or press **⏻ Sign out** in the top bar

### Per-user conversation memory (server-side)

Conversations sync to the private Blob store (`users/mem_<username>.json`),
so your chats follow **your account** across sessions — restored automatically
after every unlock. Size-capped, oldest trimmed first.

### Voice commands (added)

| Voice command | What JARVIS does |
| --- | --- |
| “log out” / “sign out” / “end my session” | Signs out and returns to the lock gate |

---

## How it fits together

```
app/page.tsx              Voice OS: command routing, streaming speech, picker flow
app/api/auth/*            register · login · logout · me · unlock (server-verified)
app/api/memory/route.ts   Per-user conversation memory (Blob, private)
app/api/chat/route.ts     The brain: knowledge + research → Ollama/OpenAI stream
lib/ai.ts                 Local engine connection: Ollama status, model, NDJSON → text
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
| Bigger local model | `OLLAMA_MODEL=llama3.1:8b` in `.env.local` (then `ollama pull llama3.1:8b`) |
| Cloud model instead | `JARVIS_AI_PROVIDER=openai` + `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4o` |
| Deeper web search | Add `TAVILY_API_KEY` in `.env.local` |
| Document answers (Phase 3) | Retrieve matching chunks, prepend to the prompt |

---

## Voice notes

- Uses the free built-in **Web Speech API** — no API cost.
- Chrome / Edge / Safari supported; Firefox has no speech recognition (mic hides automatically).
- Toggle with **🔊 Voice ON** in the top bar, or stop any speech by clicking it mid-sentence.
