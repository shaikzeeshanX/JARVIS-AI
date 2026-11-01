import { NextRequest, NextResponse } from "next/server"
import {
  attachSession,
  readUser,
  sessionFromRequest,
  signSession,
  verifyPassword,
} from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/unlock — the Linux-terminal password gate.
 *
 * The user already has a session (we know WHO they are); this verifies
 * their password AGAIN on every fresh open of JARVIS, exactly like a
 * locked workstation. Wrong password → 401, session unchanged.
 */
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req)
  if (!session) {
    return NextResponse.json(
      { error: "No session. Sign in from the account gate." },
      { status: 401 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  const password = String(body?.password ?? "")
  if (!password) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 })
  }

  try {
    const user = await readUser(session.u)
    if (!user || !verifyPassword(password, user.pass)) {
      return NextResponse.json(
        { error: "Access denied. Incorrect password." },
        { status: 401 }
      )
    }

    // Correct → mint a fresh 7-day session so the unlocked state lasts.
    const token = signSession(user.username, user.email)
    const res = NextResponse.json({
      user: { username: user.username, email: user.email },
      unlocked: true,
    })
    attachSession(res, token)
    return res
  } catch (e) {
    console.error("unlock failed:", e)
    return NextResponse.json(
      { error: "Authentication service unavailable. Try again shortly." },
      { status: 500 }
    )
  }
}
