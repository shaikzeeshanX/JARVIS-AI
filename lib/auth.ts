/**
 * JARVIS server-side authentication.
 *
 * - Passwords: PBKDF2-SHA256, 150k iterations, per-user random salt.
 * - Sessions: HMAC-SHA256 signed token in an HttpOnly cookie (7 days).
 * - User records: Vercel Blob (private store) — persistent across serverless
 *   invocations, unlike a filesystem.
 *
 * Server-only: never import from client components.
 */

import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto"
import { put, get, del, list } from "@vercel/blob"
import type { NextRequest, NextResponse } from "next/server"

const SESSION_COOKIE = "jarvis_session"
const SESSION_TTL = 60 * 60 * 24 * 7 // 7 days
const ITERATIONS = 150_000

// ── Passwords ─────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256").toString("hex")
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [, iterStr, salt, expected] = stored.split("$")
    const iterations = Number(iterStr)
    if (!salt || !expected || !Number.isFinite(iterations)) return false
    const actual = pbkdf2Sync(password, salt, iterations, 32, "sha256")
    const expectedBuf = Buffer.from(expected, "hex")
    if (actual.length !== expectedBuf.length) return false
    return timingSafeEqual(actual, expectedBuf)
  } catch {
    return false
  }
}

// ── Sessions ──────────────────────────────────────────────────

function secret(): string {
  const s = process.env.AUTH_SECRET
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      console.error("AUTH_SECRET missing — refusing to sign sessions.")
    }
    return "jarvis-insecure-dev-secret"
  }
  return s
}

function hmac(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url")
}

export interface Session {
  u: string // username
  e: string // email
  iat: number
  exp: number
}

export function signSession(username: string, email: string): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: Session = {
    u: username,
    e: email,
    iat: now,
    exp: now + SESSION_TTL,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${body}.${hmac(body)}`
}

export function verifySession(token: string | undefined | null): Session | null {
  if (!token) return null
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = hmac(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Session
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null
    if (typeof payload.u !== "string" || typeof payload.e !== "string") return null
    return payload
  } catch {
    return null
  }
}

export function sessionFromRequest(req: NextRequest): Session | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value)
}

export function attachSession(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
    secure: process.env.NODE_ENV === "production",
  })
}

export function clearSession(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  })
}

// ── User records (Vercel Blob, private store) ─────────────────

export interface UserRecord {
  username: string
  email: string
  pass: string // hashed
  createdAt: number
}

const ACCESS = "private" as const

const userPath = (username: string) => `users/u_${username.toLowerCase()}.json`
const emailPath = (email: string) => `users/e_${email.toLowerCase()}.json`

export async function readUser(username: string): Promise<UserRecord | null> {
  try {
    const found = await get(userPath(username), { access: ACCESS, useCache: false })
    if (!found) return null
    const text = await new Response(found.stream).text()
    return JSON.parse(text) as UserRecord
  } catch {
    return null
  }
}

export async function usernameForEmail(email: string): Promise<string | null> {
  try {
    const found = await get(emailPath(email), { access: ACCESS, useCache: false })
    if (!found) return null
    const text = await new Response(found.stream).text()
    const idx = JSON.parse(text) as { u: string }
    return idx.u ?? null
  } catch {
    return null
  }
}

/** Create a user; throws { code: "user_exists" | "email_exists" } on conflict. */
export async function createUser(
  username: string,
  email: string,
  passwordHash: string
): Promise<UserRecord> {
  const record: UserRecord = {
    username,
    email,
    pass: passwordHash,
    createdAt: Date.now(),
  }

  try {
    await put(userPath(username), JSON.stringify(record), {
      access: ACCESS,
      allowOverwrite: false,
      contentType: "application/json",
    })
  } catch (e) {
    if (String(e).includes("exists") || String((e as any)?.statusCode) === "409") {
      throw { code: "user_exists" }
    }
    throw e
  }

  try {
    await put(emailPath(email), JSON.stringify({ u: username }), {
      access: ACCESS,
      allowOverwrite: false,
      contentType: "application/json",
    })
  } catch (e) {
    // Email already taken — roll back the username record.
    await del(userPath(username)).catch(() => {})
    if (String(e).includes("exists") || String((e as any)?.statusCode) === "409") {
      throw { code: "email_exists" }
    }
    throw e
  }

  return record
}

/** Diagnostic: count user records (no contents). */
export async function countUsers(): Promise<number> {
  try {
    const res = await list({ prefix: "users/u_" })
    return res.blobs.length
  } catch {
    return -1
  }
}

// ── Shared validation ─────────────────────────────────────────

export const validators = {
  username: (v: unknown): string | null => {
    if (typeof v !== "string") return "Username is required."
    const s = v.trim()
    if (s.length < 3 || s.length > 24) return "Username must be 3–24 characters."
    if (!/^[a-zA-Z0-9_.-]+$/.test(s))
      return "Username may use letters, numbers, dot, dash, underscore."
    return null
  },
  email: (v: unknown): string | null => {
    if (typeof v !== "string") return "Email is required."
    const s = v.trim().toLowerCase()
    if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s))
      return "Enter a valid email address."
    return null
  },
  password: (v: unknown): string | null => {
    if (typeof v !== "string") return "Password is required."
    if (v.length < 8) return "Password must be at least 8 characters."
    if (v.length > 200) return "Password is too long."
    return null
  },
}
