import { NextRequest, NextResponse } from "next/server"
import { sessionFromRequest } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/auth/me — who is signed in (verifies the cookie server-side). */
export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
  }
  return NextResponse.json({
    user: { username: session.u, email: session.e },
    exp: session.exp,
  })
}
