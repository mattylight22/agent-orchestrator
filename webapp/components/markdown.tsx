"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";

export function Markdown({ children }: { children: string }) {
  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize, rehypeHighlight]} components={{
    a: ({ href, children }) => <a href={href?.startsWith("https://") ? href : undefined} target="_blank" rel="noreferrer">{children}</a>,
    code: ({ children, className }) => <code className={className}>{children}</code>,
  }}>{children}</ReactMarkdown></div>;
}
