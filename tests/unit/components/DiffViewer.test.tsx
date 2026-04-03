import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@monaco-editor/react", () => ({
  default: (props: { value: string; language: string }) => (
    <div data-testid="diff-editor" data-language={props.language}>
      {props.value}
    </div>
  ),
}));

import { DiffViewer } from "../../../src/features/viewer/DiffViewer";

describe("DiffViewer", () => {
  it("renders unified diff content in read-only mode", () => {
    render(
      <DiffViewer
        path="src/index.ts"
        content={"@@ -1 +1 @@\n-export const hello = \"world\";\n+export const hello = \"phase-2\";\n"}
      />,
    );

    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(screen.getByTestId("diff-editor")).toHaveTextContent("+export const hello = \"phase-2\";");
  });
});
