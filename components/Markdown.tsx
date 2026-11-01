"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-[15px] leading-7 text-slate-300">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
