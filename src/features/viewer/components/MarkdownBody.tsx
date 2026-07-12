import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

export function MarkdownBody({ content }: { content: string }) {
	return (
		<div className="shell-md-body">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
