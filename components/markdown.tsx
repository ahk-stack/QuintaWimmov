import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a news body.
 *
 * `rehype-raw` is deliberately NOT installed, so raw HTML in a body is rendered
 * as text rather than markup. News is authored through the app by people whose
 * identity is a name picked from a dropdown, and the article page is readable by
 * anyone with the URL, so treating the body as untrusted is the only safe
 * assumption.
 *
 * Elements are mapped explicitly instead of using a typography plugin, because
 * the brand allows only Caladea headings, Lato body, and no colour outside the
 * status system.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h2 className="mt-10 mb-3 text-2xl first:mt-0">{children}</h2>
        ),
        h2: ({ children }) => (
          <h2 className="mt-10 mb-3 text-xl first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-8 mb-2 text-base first:mt-0">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="mb-4 text-base leading-relaxed">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="mb-4 list-disc space-y-1.5 pl-5 text-base leading-relaxed">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-base leading-relaxed">
            {children}
          </ol>
        ),
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => (
          <strong className="font-bold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ href, children }) => (
          <a
            href={href}
            // Bodies are user-authored, so outbound links get no referrer and
            // no window.opener handle.
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline decoration-1 underline-offset-2 hover:no-underline"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-4 border-l-2 border-line-strong pl-4 text-muted italic">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-sm">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="mb-4 overflow-x-auto rounded-lg border border-line bg-surface p-4 font-mono text-sm">
            {children}
          </pre>
        ),
        hr: () => <hr className="my-8 border-line" />,
        table: ({ children }) => (
          // Wide tables scroll inside their own container rather than the page.
          <div className="mb-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-line-strong px-3 py-2 text-left font-bold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-line px-3 py-2 align-top">
            {children}
          </td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
