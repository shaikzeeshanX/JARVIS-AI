import { NextResponse } from "next/server"
import { clearSession } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST /api/auth/logout — revoke the session cookie. */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  clearSession(res)
  return res
}
