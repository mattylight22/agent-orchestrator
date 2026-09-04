import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

function Code({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  if (!className) return <code>{children}</code>;
  return (
    <div className="code-block">
      <button className="code-copy" aria-label="Copy code" onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
      <code className={className}>{children}</code>
    </div>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeSanitize]}
        components={{
          code: Code,
          a: ({ href, children: linkChildren }) => (
            <a href={href} onClick={(event) => {
              event.preventDefault();
              if (href?.startsWith("https://")) void window.lens.openExternal(href);
            }}>{linkChildren}</a>
          ),
        }}
      >{children}</ReactMarkdown>
    </div>
  );
}
