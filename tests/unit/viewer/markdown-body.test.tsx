import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownBody } from "../../../src/features/viewer/components/MarkdownBody";

describe("MarkdownBody", () => {
	it("wraps its output in the shell-md-body root class", () => {
		const { container } = render(<MarkdownBody content="hello" />);
		const root = container.querySelector(".shell-md-body");
		expect(root).not.toBeNull();
		expect(root!.textContent).toContain("hello");
	});

	it("renders GFM tables", () => {
		const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
		const { container } = render(<MarkdownBody content={md} />);
		expect(container.querySelector(".shell-md-body table")).not.toBeNull();
	});

	it("renders GFM task-list checkboxes", () => {
		const { container } = render(<MarkdownBody content="- [ ] todo" />);
		const li = container.querySelector("li.task-list-item");
		expect(li).not.toBeNull();
		expect(li!.querySelector('input[type="checkbox"]')).not.toBeNull();
	});

	it("applies hljs classes to fenced code", () => {
		const { container } = render(
			<MarkdownBody content={"```js\nconst x = 1;\n```"} />,
		);
		expect(container.querySelector("pre code.hljs")).not.toBeNull();
		expect(container.querySelector(".hljs-keyword")).not.toBeNull();
	});
});
