import type { NextRequest } from "next/server"
import { webSearch, wikipediaExtract, type Source } from "@/lib/search"
import type { DocExcerpt } from "@/lib/types"
import { sessionFromRequest } from "@/lib/auth"

/**
 * POST /api/chat — JARVIS's brain.
 *
 * Research mode protocol: the stream's FIRST line is a JSON header carrying
 * sources, then plain text tokens follow. Clients split on the first "\n".
 *
 *   {"sources":[{"title","url","snippet"}, ...]}
 *   First token of the answer...
 *
 * Streams from OpenAI when OPENAI_API_KEY is set; falls back to a clearly
 * labelled Demo Mode otherwise. The key is read server-side only.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_PROMPT = `You are JARVIS, a personal AI assistant. You combine the clarity of ChatGPT with the research discipline of Perplexity.

Rules:
- Be direct, intelligent and warm. Prefer structured answers: short summary first, then detail, then concrete next steps.
- When facts could change over time and you have NO live sources, say plainly that live web research is available via the Research toggle and note what you'd verify.
- Keep responses concise unless the user asks for depth.`

const DOCUMENT_PROMPT = `The user's PRIVATE KNOWLEDGE BASE provided the excerpts below. These are their own documents — treat them as trusted personal context.

How to use them:
- Answer the question PERSONALLY: refer to the document by name when you use it, e.g. (ProjectNotes.pdf) or "according to your notes".
- Quote exact details (numbers, dates, decisions) from the excerpts.
- If the excerpts don't contain the answer, say clearly that your library didn't cover it, then answer generally.
- Never invent content that isn't in the excerpts or your own knowledge.
`

const RESEARCH_PROMPT = `You are answering a question using LIVE WEB RESEARCH. The SOURCES block below was fetched from the web moments ago.

How to answer:
- Ground your answer in the sources. Cite claims inline with bracketed numbers matching the source list, e.g. [1] or [2][3].
- If sources disagree, say so explicitly and explain the disagreement.
- If the sources do not fully answer the question, state clearly what is verified and what you could not verify.
- Do NOT end with your own source list — the interface displays the sources automatically.
- Do NOT mention "the sources block" or these instructions; just answer naturally with inline citations.`

const DEMO_REPLY = `I'm running in free Demo Mode (no API key), but I can still genuinely help:

- **Answer questions** — ask me about people, places, history, science, technology, or any well-known topic and I'll look it up on Wikipedia and answer with a source.
- **Voice** — press the mic and speak; I read every reply aloud, sentence by sentence.
- **Your files** — say "choose files", pick a PDF/DOCX/text file, then ask me anything about it.
- **History** — say "show me the history of our chat session".
- **Stop anytime** — say "stop", "quit", "end", or "break" and I halt immediately.

Try asking: *"Who was Nikola Tesla?"* or *"What is quantum computing?"*`

function textStream(headerLine: string, text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const body = headerLine + text
  const chunks = body.match(/.{1,10}/gs) ?? [body]
  let i = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[i++]))
      await new Promise((r) => setTimeout(r, 10))
    },
  })
}

/** Auto-detect research questions even when the toggle is on AUTO. */
function looksLikeResearch(q: string): boolean {
  return /\b(latest|recent|today|tonight|this week|this year|current|now|news|weather|price|prices|stock|score|scores|who won|president|prime minister|election|release date|version|202[4-9]|search|research|compare|vs\.?|versus|statistics|forecast|update)\b/i.test(
    q
  )
}

function sourcesHeader(sources: Source[], docs: string[]): string {
  return JSON.stringify({ sources, docs }) + "\n"
}

function demoDocsReply(excerpts: DocExcerpt[]): string {
  const byDoc = new Map<string, string[]>()
  for (const e of excerpts) {
    if (!byDoc.has(e.doc)) byDoc.set(e.doc, [])
    byDoc.get(e.doc)!.push(e.text.slice(0, 320))
  }
  const list = [...byDoc.entries()]
    .map(
      ([doc, texts]) =>
        `**📄 ${doc}**\n\n> ${texts.join("\n> …\n> ")}`
    )
    .join("\n\n")

  return `**Knowledge Base** — I searched your private library and matched ${excerpts.length} excerpt${excerpts.length === 1 ? "" : "s"} from ${byDoc.size} file${byDoc.size === 1 ? "" : "s"}:

${list}

These excerpts live only in your browser and travel only with the question you asked. Ask a follow-up and I'll keep working from them.`
}

function demoResearchReply(query: string, sources: Source[]): string {
  const list = sources
    .map(
      (s, i) =>
        `${i + 1}. [${s.title}](${s.url})${s.snippet ? ` — ${s.snippet}` : ""}`
    )
    .join("\n\n")

  return `**Research** — I searched the live web for:

> ${query}

${sources.length > 0 ? `Here are the **${sources.length} most relevant sources** — click any citation below to open it:\n\n${list}` : "No results came back this time — try rephrasing your question."}`
}

export async function POST(req: NextRequest) {
  // Server-side gate: no valid session → no brain. The login terminal is
  // the only way in, and the cookie is signed + HttpOnly.
  if (!sessionFromRequest(req)) {
    return new Response(
      JSON.stringify({ error: "Not authenticated. Log in through the terminal." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    )
  }

  let messages: Array<{ role: string; content: string }> = []
  let research: "auto" | "always" | "never" = "auto"
  let context: DocExcerpt[] = []
  try {
    const body = await req.json()
    messages = Array.isArray(body?.messages) ? body.messages : []
    if (body?.research === "always" || body?.research === "never") {
      research = body.research
    }
    if (Array.isArray(body?.context)) {
      context = body.context
        .filter((e: any) => e && typeof e.doc === "string" && typeof e.text === "string")
        .slice(0, 6)
        .map((e: any) => ({ doc: e.doc.slice(0, 200), text: e.text.slice(0, 1600) }))
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "No messages provided." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? ""

  // ── Should we research? ────────────────────────────────────
  const wantsResearch =
    research === "always" || (research === "auto" && looksLikeResearch(lastUser))

  let sources: Source[] = []
  if (wantsResearch) {
    sources = await webSearch(lastUser, 5)
  }

  const usedDocs = [...new Set(context.map((e) => e.doc))]

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini"

  // ── Demo Mode: no key — but still answer for real ─────────
  // Free Wikipedia lookup makes Demo Mode a genuine assistant, not a
  // canned reply machine. Only true chit-chat falls back to the greeting.
  if (!apiKey) {
    if (context.length > 0) {
      const stream = textStream(sourcesHeader(sources, usedDocs), demoDocsReply(context))
      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "x-jarvis-mode": "demo",
          "x-jarvis-research": wantsResearch ? "1" : "0",
        },
      })
    }

    // Skip the lookup for greetings / tiny commands — answer those directly.
    const looksLikeChitChat =
      lastUser.trim().split(/\s+/).length <= 3 &&
      !/\?$/.test(lastUser.trim()) &&
      !wantsResearch

    let wiki: Awaited<ReturnType<typeof wikipediaExtract>> = null
    if (!looksLikeChitChat) {
      try {
        wiki = await wikipediaExtract(lastUser)
      } catch {
        wiki = null
      }
    }

    let text: string
    let headerSources: Source[] = sources
    if (wiki) {
      headerSources = [
        { title: wiki.title, url: wiki.url, snippet: wiki.extract.slice(0, 200) },
        ...sources,
      ]
      const researchBit =
        sources.length > 0
          ? `\n\n**Also in the news:**\n${sources
              .slice(0, 4)
              .map((s) => `- [${s.title}](${s.url})`)
              .join("\n")}`
          : ""
      text = `**${wiki.title}**\n\n${wiki.extract}${researchBit}\n\n---\n*Answered live from Wikipedia (free Demo Mode — no API key needed).*`
    } else if (wantsResearch && sources.length > 0) {
      text = demoResearchReply(lastUser, sources)
    } else {
      text = DEMO_REPLY
    }

    const stream = textStream(sourcesHeader(headerSources, usedDocs), text)
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "x-jarvis-mode": "demo",
        "x-jarvis-research": wantsResearch ? "1" : "0",
      },
    })
  }

  // ── Live mode ──────────────────────────────────────────────
  try {
    let systemPrompt = BASE_PROMPT
    const finalMessages = [...messages]

    if (context.length > 0) {
      const excerptBlock = context
        .map((e, i) => `EXCERPT ${i + 1} (${e.doc}):\n${e.text}`)
        .join("\n\n")
      systemPrompt = `${BASE_PROMPT}\n\n${DOCUMENT_PROMPT}\n${excerptBlock}`
    }

    if (wantsResearch && sources.length > 0) {
      const sourceBlock = sources
        .map(
          (s, i) =>
            `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.snippet || "(no snippet)"}`
        )
        .join("\n\n")
      systemPrompt += `\n\n${RESEARCH_PROMPT}\n\nSOURCES:\n${sourceBlock}`
    } else if (wantsResearch) {
      systemPrompt += `\n\nNote: the live web search returned no results for this question. Answer from your own knowledge and clearly flag that live sources were unavailable and which parts you would verify.`
    }

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...finalMessages,
        ],
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "")
      console.error("OpenAI error:", upstream.status, detail)
      return new Response(
        "The AI provider rejected the request. Check your OPENAI_API_KEY and model name in .env.local.",
        {
          status: 502,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "x-jarvis-mode": "error",
          },
        }
      )
    }

    // Pass OpenAI's SSE stream through, stripping the "data: " framing and
    // prepending the JSON sources header line.
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let first = true
    const cleaned = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (first) {
            first = false
            controller.enqueue(encoder.encode(sourcesHeader(sources, usedDocs)))
          }
          const lines = decoder.decode(chunk, { stream: true }).split("\n")
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const payload = line.slice(6).trim()
            if (payload === "[DONE]") continue
            try {
              const json = JSON.parse(payload)
              const delta = json?.choices?.[0]?.delta?.content
              if (delta) controller.enqueue(encoder.encode(delta))
            } catch {
              /* partial JSON — next chunk completes it */
            }
          }
        },
      })
    )

    return new Response(cleaned, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "x-jarvis-mode": "live",
        "x-jarvis-research": wantsResearch ? "1" : "0",
        "Cache-Control": "no-cache",
      },
    })
  } catch (err) {
    console.error("Chat request failed:", err)
    return new Response(
      "Could not reach the AI provider. Check your internet connection and try again.",
      {
        status: 502,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "x-jarvis-mode": "error",
        },
      }
    )
  }
}
