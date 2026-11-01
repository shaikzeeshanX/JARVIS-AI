import { NextRequest, NextResponse } from "next/server"
import { get, put } from "@vercel/blob"
import { sessionFromRequest } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/memory — per-user conversation memory, stored server-side.
 *
 *   GET  → the signed-in user's saved conversations
 *   POST → save them (size-capped; oldest trimmed first)
 *
 * This is what lets JARVIS remember a particular user's conversations
 * across sessions and devices — keyed by the account, never by browser.
 */

const MAX_BYTES = 900_000 // keep well under blob single-value limits

const memPath = (username: string) => `users/mem_${username.toLowerCase()}.json`

export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
  }

  try {
    const found = await get(memPath(session.u), {
      access: "private",
      useCache: false,
    })
    if (!found) return NextResponse.json({ conversations: [] })
    const text = await new Response(found.stream).text()
    const data = JSON.parse(text)
    return NextResponse.json({
      conversations: Array.isArray(data?.conversations) ? data.conversations : [],
    })
  } catch {
    return NextResponse.json({ conversations: [] })
  }
}

export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  let conversations = Array.isArray(body?.conversations) ? body.conversations : []
  conversations = conversations
    .filter((c: any) => c && typeof c.id === "string" && Array.isArray(c.messages))
    .slice(0, 60)

  // Size cap: drop oldest conversations until it fits.
  let payload = JSON.stringify({ conversations })
  while (payload.length > MAX_BYTES && conversations.length > 1) {
    // Keep the most recently updated.
    conversations.sort(
      (a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    )
    conversations = conversations.slice(0, Math.floor(conversations.length * 0.75))
    payload = JSON.stringify({ conversations })
  }

  try {
    await put(memPath(session.u), payload, {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
    })
    return NextResponse.json({ ok: true, count: conversations.length })
  } catch (e) {
    console.error("memory save failed:", e)
    return NextResponse.json({ error: "Could not save memory." }, { status: 500 })
  }
}
