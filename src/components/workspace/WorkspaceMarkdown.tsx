import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeHighlight } from "@/components/chat/CodeHighlight";

const markdownLink = ({
  node: _node,
  ...props
}: {
  node?: any;
  [key: string]: any;
}) => {
  const href = typeof props.href === "string" ? props.href : undefined;

  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (!href) {
          return;
        }
        event.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      rel="noopener noreferrer"
    />
  );
};

export function WorkspaceMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-foreground dark:prose-invert prose-headings:mb-2 prose-p:my-1 prose-pre:my-0 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeHighlight,
          a: markdownLink,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
