import { NextRequest } from "next/server"
import { extractText, getDocumentProxy } from "unpdf"
import mammoth from "mammoth"
import { sessionFromRequest } from "@/lib/auth"

/**
 * POST /api/parse — turns uploaded files into plain text for the knowledge
 * base. Supports PDF, DOCX, TXT, MD, CSV, JSON.
 *
 * Privacy: files are parsed and reduced to text here, then the text is stored
 * in the user's browser (IndexedDB). Nothing is persisted on the server.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 12 * 1024 * 1024 // 12 MB per file

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "json", "log", "rtf"])

export interface ParsedFile {
  name: string
  ok: boolean
  chars: number
  text: string
  error?: string
}

async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""

  if (file.size > MAX_BYTES) {
    return { name, ok: false, chars: 0, text: "", error: "File exceeds 12 MB." }
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())

    if (ext === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const { text } = await extractText(pdf, { mergePages: true })
      const clean = text.replace(/\n{3,}/g, "\n\n").trim()
      return {
        name,
        ok: clean.length > 0,
        chars: clean.length,
        text: clean,
        error: clean.length > 0 ? undefined : "No extractable text (scanned image PDF?).",
      }
    }

    if (ext === "docx") {
      const result = await mammoth.extractRawText({ buffer })
      const clean = result.value.replace(/\n{3,}/g, "\n\n").trim()
      return { name, ok: clean.length > 0, chars: clean.length, text: clean }
    }

    if (TEXT_EXT.has(ext) || ext === "") {
      const clean = buffer.toString("utf-8").replace(/\u0000/g, "").trim()
      return { name, ok: clean.length > 0, chars: clean.length, text: clean }
    }

    return {
      name,
      ok: false,
      chars: 0,
      text: "",
      error: `Unsupported type ".${ext}". Use PDF, DOCX, TXT, MD, CSV or JSON.`,
    }
  } catch (e) {
    console.error("Parse failed for", name, e)
    return { name, ok: false, chars: 0, text: "", error: "Could not read this file." }
  }
}

export async function POST(req: NextRequest) {
  // Server-side gate: authenticated sessions only.
  if (!sessionFromRequest(req)) {
    return Response.json(
      { error: "Not authenticated. Log in through the terminal." },
      { status: 401 }
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 })
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return Response.json({ error: "No files provided." }, { status: 400 })
  }
  if (files.length > 10) {
    return Response.json({ error: "Maximum 10 files per upload." }, { status: 400 })
  }

  const parsed: ParsedFile[] = []
  for (const f of files) {
    parsed.push(await parseFile(f))
  }

  return Response.json({ files: parsed })
}
