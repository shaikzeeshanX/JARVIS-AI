import type { NextRequest } from "next/server"
import { webSearch, type Source } from "@/lib/search"
import type { DocExcerpt } from "@/lib/types"
import { sessionFromRequest } from "@/lib/auth"
import {
  AiUnavailableError,
  ollamaModel,
  ollamaStatus,
  streamOllamaChat,
  type AiMessage,
} from "@/lib/ai"

/**
 * POST /api/chat — JARVIS's brain.
 *
 * Stream protocol: the FIRST line of the body is a JSON header carrying
 * sources + the documents used, then plain text tokens follow. Clients split
 * on the first "\n".
 *
 *   {"sources":[{"title","url","snippet"}, ...],"docs":["ProjectNotes.pdf"]}
 *   First token of the answer...
 *
 * Engines (JARVIS_AI_PROVIDER):
 *   auto (default) → local Ollama, falling back to OpenAI only if a key is set
 *   ollama         → local Ollama only
 *   openai         → cloud OpenAI only (needs OPENAI_API_KEY)
 *
 * There is no Demo Mode: if no engine can answer, the route returns 503 with a
 * message the user can act on. Keys are read server-side only.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_PROMPT = `You are JARVIS, a personal AI assistant. You combine the clarity of ChatGPT with the research discipline of Perplexity.

Rules:
- Be direct, intelligent and warm. Prefer structured answers: short summary first, then detail, then concrete next steps.
- When facts could change over time and you have NO live sources, say plainly what you are unsure of and what you would verify.
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

/** Auto-detect research questions. */
function looksLikeResearch(q: string): boolean {
  return /\b(latest|recent|today|tonight|this week|this year|current|now|news|weather|price|prices|stock|score|scores|who won|president|prime minister|election|release date|version|202[4-9]|search|research|compare|vs\.?|versus|statistics|forecast|update)\b/i.test(
    q
  )
}

function sourcesHeader(sources: Source[], docs: string[]): string {
  return JSON.stringify({ sources, docs }) + "\n"
}

/** Prepend the JSON header line to an engine's text stream. */
function withHeader(
  header: string,
  body: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let first = true
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (first) {
          first = false
          controller.enqueue(encoder.encode(header))
        }
        controller.enqueue(chunk)
      },
      flush(controller) {
        if (first) controller.enqueue(encoder.encode(header))
      },
    })
  )
}

function toAiMessages(messages: Array<{ role: string; content: string }>): AiMessage[] {
  return messages
    .filter((m) => typeof m?.content === "string" && m.content.length > 0)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }))
}

function buildSystemPrompt(
  context: DocExcerpt[],
  sources: Source[],
  wantsResearch: boolean
): string {
  let systemPrompt = BASE_PROMPT

  if (context.length > 0) {
    const excerptBlock = context
      .map((e, i) => `EXCERPT ${i + 1} (${e.doc}):\n${e.text}`)
      .join("\n\n")
    systemPrompt = `${systemPrompt}\n\n${DOCUMENT_PROMPT}\n${excerptBlock}`
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

  return systemPrompt
}

function textError(message: string, status: number, mode: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-jarvis-mode": mode,
      "Cache-Control": "no-store",
    },
  })
}

export async function POST(req: NextRequest) {
  // Server-side gate: no valid session → no brain.
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
  const systemPrompt = buildSystemPrompt(context, sources, wantsResearch)
  const header = sourcesHeader(sources, usedDocs)

  const engine = (process.env.JARVIS_AI_PROVIDER || "auto").toLowerCase()
  const apiKey = process.env.OPENAI_API_KEY

  // ── Local engine: Ollama (default) ─────────────────────────
  if (engine !== "openai") {
    try {
      const stream = await streamOllamaChat([
        { role: "system", content: systemPrompt },
        ...toAiMessages(messages),
      ])

      return new Response(withHeader(header, stream), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "x-jarvis-mode": "ollama",
          "x-jarvis-model": ollamaModel(),
          "x-jarvis-research": wantsResearch ? "1" : "0",
          "Cache-Control": "no-cache",
        },
      })
    } catch (err) {
      const message =
        err instanceof AiUnavailableError
          ? err.message
          : `The local AI engine failed to answer: ${
              err instanceof Error ? err.message : String(err)
            }`

      // auto mode may still have a cloud key to fall back on.
      if (!(apiKey && engine === "auto")) {
        console.error("Ollama unavailable:", message)
        return textError(message, 503, "offline")
      }
      console.error("Ollama unavailable, falling back to OpenAI:", message)
    }
  }

  // ── Cloud engine: OpenAI (optional) ────────────────────────
  if (!apiKey) {
    const status = await ollamaStatus()
    const detail = status.reachable
      ? `Ollama is running at ${status.baseUrl}, but the model "${ollamaModel()}" is unavailable.`
      : `Ollama is not reachable at ${status.baseUrl}.`
    return textError(
      `No AI engine is available. ${detail} ` +
        `Start Ollama with "ollama serve" and run "ollama pull ${ollamaModel()}", ` +
        `or add OPENAI_API_KEY to .env.local.`,
      503,
      "offline"
    )
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini"

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "")
      console.error("OpenAI error:", upstream.status, detail)
      return textError(
        "The cloud AI provider rejected the request. Check OPENAI_API_KEY and OPENAI_MODEL in .env.local.",
        502,
        "offline"
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
            controller.enqueue(encoder.encode(header))
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
        "x-jarvis-model": model,
        "x-jarvis-research": wantsResearch ? "1" : "0",
        "Cache-Control": "no-cache",
      },
    })
  } catch (err) {
    console.error("Chat request failed:", err)
    return textError(
      "Could not reach the cloud AI provider. Check your internet connection, or switch to the local Ollama engine.",
      502,
      "offline"
    )
  }
}
