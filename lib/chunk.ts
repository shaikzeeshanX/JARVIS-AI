/**
 * Chunking + retrieval for JARVIS's knowledge base — isomorphic (runs in the
 * browser for privacy-first retrieval; usable on the server too).
 *
 * No embeddings needed for Phase 3: chunks are scored by weighted keyword
 * overlap, which is fast, free and surprisingly effective for personal
 * documents. When cloud accounts arrive (Phase 5), swap `retrieve` for vector
 * search — the call sites don't change.
 */

const STOP = new Set(
  ("a an the and or but if then else for to of in on at by with from is are was were be been being " +
    "i you he she it we they me him her us them my your his its our their this that these those " +
    "what which who whom whose when where why how not no nor so too very can will just should would " +
    "do does did doing have has had having am as about into over under again there here all any both " +
    "each few more most other some such only own same than because while during before after above " +
    "below up down out off further once s t don now")
    .split(" ")
    .filter(Boolean)
)

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

/**
 * Split text into overlapping chunks. Paragraph breaks are respected so a
 * chunk never cuts a sentence in half when it can avoid it.
 */
export function chunkText(text: string, size = 1100, overlap = 180): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]

  const paragraphs = clean.split(/\n{2,}/)
  const chunks: string[] = []
  let buf = ""

  const flush = () => {
    const t = buf.trim()
    if (t) chunks.push(t)
    buf = ""
  }

  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > size) {
      flush()
      if (p.length > size) {
        // One giant paragraph: hard-split with overlap.
        let start = 0
        while (start < p.length) {
          chunks.push(p.slice(start, start + size).trim())
          start += size - overlap
        }
        continue
      }
    }
    buf = buf ? buf + "\n\n" + p : p
  }
  flush()
  return chunks.filter(Boolean)
}

/**
 * Score a chunk against the query: unique-term coverage dominates (does it
 * talk about the right things?), term frequency breaks ties, and a short
 * chunk with the same terms wins over a long vague one.
 */
export function scoreChunk(queryTokens: string[], chunk: string): number {
  if (queryTokens.length === 0) return 0
  const chunkTokens = tokenize(chunk)
  if (chunkTokens.length === 0) return 0

  const freq = new Map<string, number>()
  for (const t of chunkTokens) freq.set(t, (freq.get(t) ?? 0) + 1)

  let matched = 0
  let totalFreq = 0
  const seen = new Set<string>()
  for (const q of queryTokens) {
    const f = freq.get(q) ?? 0
    if (f > 0) {
      matched += 1
      totalFreq += f
      seen.add(q)
    }
  }
  if (matched === 0) return 0

  const coverage = matched / queryTokens.length
  const density = totalFreq / Math.sqrt(chunkTokens.length)
  // Require at least half the query terms to match, or it's noise.
  return coverage >= 0.5 ? coverage * 2 + density * 0.3 : 0
}

export interface RetrievedExcerpt {
  doc: string
  text: string
  score: number
}

/**
 * Retrieve the top excerpts across a library for a question.
 * Caps total characters so prompts stay lean.
 */
export function retrieve(
  query: string,
  library: Array<{ name: string; text: string }>,
  k = 4,
  maxChars = 4000
): RetrievedExcerpt[] {
  const qTokens = tokenize(query)
  if (qTokens.length === 0 || library.length === 0) return []

  const candidates: RetrievedExcerpt[] = []
  for (const doc of library) {
    for (const chunk of chunkText(doc.text)) {
      const score = scoreChunk(qTokens, chunk)
      if (score > 0) candidates.push({ doc: doc.name, text: chunk, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  const out: RetrievedExcerpt[] = []
  let chars = 0
  const seenText = new Set<string>()
  for (const c of candidates) {
    const key = c.text.slice(0, 120)
    if (seenText.has(key)) continue
    seenText.add(key)
    if (chars + c.text.length > maxChars && out.length > 0) break
    out.push(c)
    chars += c.text.length
    if (out.length >= k) break
  }
  return out
}
