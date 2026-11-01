import { NextRequest, NextResponse } from "next/server"
import {
  attachSession,
  clearUnlockFailures,
  MAX_UNLOCK_FAILS,
  readThrottle,
  readUser,
  recordUnlockFailure,
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
 * locked workstation. Wrong password → 401 and JARVIS stays shut.
 *
 * Repeated failures are counted server-side: after MAX_UNLOCK_FAILS wrong
 * passwords the account is refused for UNLOCK_LOCKOUT_MS, even if the next
 * password happens to be right. A reload no longer resets the count.
 */
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req)
  if (!session) {
    return NextResponse.json(
      { error: "No session. Sign in from the account gate." },
      { status: 401 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  const password = String((body as { password?: unknown })?.password ?? "").trim()
  if (!password) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 })
  }

  try {
    // Refuse while a lockout window is still running.
    const throttle = await readThrottle(session.u)
    const now = Date.now()
    if (throttle.until > now) {
      const seconds = Math.ceil((throttle.until - now) / 1000)
      return NextResponse.json(
        {
          error: `Too many failed attempts. Try again in ${seconds}s.`,
          retryAfter: seconds,
        },
        { status: 429 }
      )
    }

    const user = await readUser(session.u)
    if (!user || !verifyPassword(password, user.pass)) {
      const next = await recordUnlockFailure(session.u, throttle)
      if (next.until > now) {
        const seconds = Math.ceil((next.until - now) / 1000)
        return NextResponse.json(
          {
            error: `Too many failed attempts. Locked for ${seconds}s.`,
            retryAfter: seconds,
          },
          { status: 429 }
        )
      }
      return NextResponse.json(
        {
          error: "Access denied. Incorrect password.",
          attemptsLeft: MAX_UNLOCK_FAILS - next.fails,
        },
        { status: 401 }
      )
    }

    // Correct → clear the failure count and mint a fresh 7-day session.
    await clearUnlockFailures(session.u)
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
