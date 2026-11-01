import { NextRequest, NextResponse } from "next/server"
import {
  attachSession,
  readUser,
  signSession,
  usernameForEmail,
  verifyPassword,
} from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/login — verify identity + password server-side, then issue
 * a signed HttpOnly session cookie. Never leaks which field was wrong.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  const identity = String(body?.identity ?? "").trim()
  const password = String(body?.password ?? "")
  if (!identity || !password) {
    return NextResponse.json({ error: "Enter your credentials." }, { status: 400 })
  }

  try {
    const username = identity.includes("@")
      ? await usernameForEmail(identity.toLowerCase())
      : identity

    const user = username ? await readUser(username) : null
    if (!user || !verifyPassword(password, user.pass)) {
      return NextResponse.json(
        { error: "Authentication failed. Check your credentials and try again." },
        { status: 401 }
      )
    }

    const token = signSession(user.username, user.email)
    const res = NextResponse.json({
      user: { username: user.username, email: user.email },
    })
    attachSession(res, token)
    return res
  } catch (e) {
    console.error("login failed:", e)
    return NextResponse.json(
      { error: "Authentication service unavailable. Try again shortly." },
      { status: 500 }
    )
  }
}
