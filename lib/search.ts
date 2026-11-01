/**
 * Live web search for JARVIS — Phase 2.
 *
 * Providers, in order of preference:
 *  1. Tavily         — highest quality, needs TAVILY_API_KEY (optional).
 *  2. Google News    — free, no key. Best for current events / recency.
 *  3. Wikipedia      — free, no key. Best for topics, people, technology.
 *  4. DuckDuckGo     — last resort (often 403s; kept as a safety net).
 *
 * Every request has a hard timeout so a slow provider can never hang a chat.
 * Server-side only: never import from client components.
 */

export interface Source {
  title: string
  url: string
  snippet: string
}

const TIMEOUT_MS = 8000

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

async function safeFetch(
  url: string,
  init: RequestInit = {},
  timeout = TIMEOUT_MS
): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...init.headers },
      signal: AbortSignal.timeout(timeout),
    })
  } catch {
    return null
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim()
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Queries about recency get news results; everything else gets Wikipedia. */
function looksNewsy(q: string): boolean {
  return /\b(latest|recent|today|tonight|this week|this month|now|news|yesterday|202[4-9]|price|prices|stock|score|scores|election|won|launched|released|announced|breaking|update)\b/i.test(
    q
  )
}

// ── Tavily (optional, key required) ───────────────────────────

async function tavilySearch(query: string, max: number): Promise<Source[]> {
  const res = await safeFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: max,
      include_answer: false,
    }),
  })
  if (!res?.ok) throw new Error(`Tavily ${res?.status}`)
  const data = await res.json()
  return (data.results ?? []).map((r: any) => ({
    title: String(r.title ?? "Untitled").slice(0, 140),
    url: String(r.url ?? ""),
    snippet: String(r.content ?? "").slice(0, 400),
  }))
}

// ── Google News RSS (free, no key) ─────────────────────────────

async function googleNewsSearch(query: string, max: number): Promise<Source[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  const res = await safeFetch(url)
  if (!res?.ok) return []
  const xml = await res.text()

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, max)
  const grab = (block: string, tag: string) =>
    (block.match(
      new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)
    )?.[1] ?? "").trim()

  return items
    .map((m) => {
      const block = m[1]
      const title = stripTags(grab(block, "title"))
      const link = stripTags(grab(block, "link"))
      const source = stripTags(grab(block, "source"))
      const date = stripTags(grab(block, "pubDate"))
      const when = date ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""
      return {
        title: title.slice(0, 140),
        url: link,
        snippet: [source, when].filter(Boolean).join(" · "),
      }
    })
    .filter((s) => s.title && s.url)
}

// ── Wikipedia (free, no key) ───────────────────────────────────

async function wikipediaSearch(query: string, max: number): Promise<Source[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${max}&format=json`
  const res = await safeFetch(url)
  if (!res?.ok) return []
  const data = await res.json()
  const hits = data?.query?.search ?? []
  return hits.map((r: any) => ({
    title: String(r.title ?? "Untitled").slice(0, 140),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, "_"))}`,
    snippet: stripTags(String(r.snippet ?? "")).slice(0, 400),
  }))
}

/**
 * Full intro paragraph for the best-matching Wikipedia article.
 * This is what lets Demo Mode (no API key) answer real questions for free.
 * Returns null when nothing sensible matches.
 */
export async function wikipediaExtract(
  query: string
): Promise<{ title: string; url: string; extract: string } | null> {
  const q = query.trim().slice(0, 300)
  if (!q) return null

  // "Who was Nikola Tesla?" → "Nikola Tesla"; "What is photosynthesis?" → "photosynthesis"
  const cleaned = q
    .replace(
      /^(?:who|what|which|where|when|why|how)\s+(?:was|were|is|are|did|do|does|won|win|scored|scores|the|a|an)?\s*/i,
      ""
    )
    .replace(/^(?:tell me about|explain|define|describe)\s+/i, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim()

  // 1) Try the direct article first — most accurate.
  if (cleaned) {
    const directUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&exsentences=6&titles=${encodeURIComponent(cleaned.replace(/ /g, "_"))}&format=json&redirects=1`
    const res = await safeFetch(directUrl)
    if (res?.ok) {
      const data = await res.json().catch(() => null)
      const page: any = Object.values(data?.query?.pages ?? {})[0]
      // A missing page comes back with "missing" — skip it.
      if (page && !page.missing && typeof page.extract === "string") {
        const extract = page.extract.trim()
        if (extract.length >= 60) {
          return {
            title: String(page.title ?? cleaned),
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(
              String(page.title ?? cleaned).replace(/ /g, "_")
            )}`,
            extract: extract.slice(0, 1400),
          }
        }
      }
    }
  }

  // 2) Fall back to search + best hit.
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleaned || q)}&srlimit=1&format=json`
  const res = await safeFetch(searchUrl)
  if (!res?.ok) return null
  const data = await res.json().catch(() => null)
  const hit = data?.query?.search?.[0]
  if (!hit) return null
  const title = String(hit.title)

  const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&exsentences=6&titles=${encodeURIComponent(title)}&format=json`
  const res2 = await safeFetch(extractUrl)
  if (!res2?.ok) return null
  const data2 = await res2.json().catch(() => null)
  const page = Object.values(data2?.query?.pages ?? {})[0] as any
  const extract = String(page?.extract ?? "").trim()
  if (extract.length < 60) return null

  return {
    title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    extract: extract.slice(0, 1400),
  }
}

// ── DuckDuckGo HTML (last resort; often blocked) ───────────────

function resolveUrl(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com")
    const target = u.searchParams.get("uddg")
    return target ? decodeURIComponent(target) : u.toString()
  } catch {
    return href
  }
}

async function ddgSearch(query: string, max: number): Promise<Source[]> {
  const res = await safeFetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  )
  if (!res?.ok) throw new Error(`DDG ${res?.status}`)
  const html = await res.text()

  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  const titles: Array<{ url: string; title: string }> = []
  let m: RegExpExecArray | null
  while ((m = titleRe.exec(html)) && titles.length < max * 2) {
    titles.push({ url: resolveUrl(m[1]), title: stripTags(m[2]) })
  }
  const snippets: string[] = []
  while ((m = snippetRe.exec(html)) && snippets.length < max * 2) {
    snippets.push(stripTags(m[1]))
  }

  return titles
    .map((t, i) => ({
      title: t.title.slice(0, 140),
      url: t.url,
      snippet: (snippets[i] ?? "").slice(0, 400),
    }))
    .filter((s) => s.title && s.url)
    .slice(0, max)
}

// ── Orchestrator ───────────────────────────────────────────────

/** Search the live web. Never throws — returns [] when search is unavailable. */
export async function webSearch(query: string, max = 5): Promise<Source[]> {
  const q = query.trim().slice(0, 300)
  if (!q) return []

  if (process.env.TAVILY_API_KEY) {
    try {
      const r = await tavilySearch(q, max)
      if (r.length > 0) return r
    } catch (e) {
      console.error("Tavily failed, using free providers:", e)
    }
  }

  const newsy = looksNewsy(q)
  const [news, wiki] = await Promise.all([
    newsy ? googleNewsSearch(q, max) : Promise.resolve([]),
    wikipediaSearch(q, max),
  ])

  // News leads for recency questions; Wikipedia anchors topics.
  const merged = [...news, ...wiki].slice(0, max)
  if (merged.length > 0) return merged

  try {
    return await ddgSearch(q, max)
  } catch {
    return []
  }
}
