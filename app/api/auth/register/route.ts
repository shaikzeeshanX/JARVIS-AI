import { NextRequest, NextResponse } from "next/server"
import {
  attachSession,
  createUser,
  hashPassword,
  signSession,
  validators,
} from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/register — create an account the terminal way.
 * Server validates, hashes (PBKDF2 150k) and persists before issuing a
 * signed HttpOnly session cookie.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  const username = String(body?.username ?? "")
  const email = String(body?.email ?? "")
  const password = String(body?.password ?? "")

  const errors = [
    validators.username(username),
    validators.email(email),
    validators.password(password),
  ].filter(Boolean)
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0] }, { status: 400 })
  }

  try {
    const user = await createUser(username.trim(), email.trim().toLowerCase(), hashPassword(password))
    const token = signSession(user.username, user.email)
    const res = NextResponse.json(
      { user: { username: user.username, email: user.email } },
      { status: 201 }
    )
    attachSession(res, token)
    return res
  } catch (e: any) {
    if (e?.code === "user_exists") {
      return NextResponse.json({ error: "That username is taken." }, { status: 409 })
    }
    if (e?.code === "email_exists") {
      return NextResponse.json(
        { error: "An account with that email already exists — try 'login'." },
        { status: 409 }
      )
    }
    console.error("register failed:", e)
    return NextResponse.json(
      { error: "Could not create the account. Try again in a moment." },
      { status: 500 }
    )
  }
}
