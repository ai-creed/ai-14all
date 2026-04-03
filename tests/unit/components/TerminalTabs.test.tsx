import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TerminalTabs } from "../../../src/features/terminals/TerminalTabs";

describe("TerminalTabs", () => {
  it("renders terminal labels and active state", () => {
    render(
      <TerminalTabs
        tabs={[
          { sessionId: "term-1", label: "shell 1" },
          { sessionId: "term-2", label: "shell 2" },
        ]}
        activeSessionId="term-2"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "shell 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "shell 2" })).toHaveAttribute("data-active", "true");
  });

  it("calls add, select, and close handlers", () => {
    const onAdd = vi.fn();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <TerminalTabs
        tabs={[{ sessionId: "term-1", label: "shell 1" }]}
        activeSessionId="term-1"
        onSelect={onSelect}
        onAdd={onAdd}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "shell 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Close shell 1" }));

    expect(onAdd).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("term-1");
    expect(onClose).toHaveBeenCalledWith("term-1");
  });
});
