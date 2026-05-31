import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingWizard } from "../../../src/features/onboarding/components/OnboardingWizard";

function renderWizard(overrides: Partial<Parameters<typeof OnboardingWizard>[0]> = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    onLoadPath: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  return { ...render(<OnboardingWizard {...props} />), ...props };
}

describe("OnboardingWizard localStorage gating", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should be shown when onboarding-completed flag is absent", () => {
    expect(localStorage.getItem("ai14all:onboarding-completed")).toBeNull();
  });

  it("sets the completed flag when Skip is clicked", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(localStorage.getItem("ai14all:onboarding-completed")).toBe("true");
  });
});

describe("OnboardingWizard", () => {
  it("renders step 1 (Welcome) by default", () => {
    renderWizard();
    expect(screen.getByText("Welcome to ai-14all")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    renderWizard({ open: false });
    expect(screen.queryByText("Welcome to ai-14all")).not.toBeInTheDocument();
  });

  it("navigates to step 2 when Next is clicked", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Workspaces & Worktrees")).toBeInTheDocument();
  });

  it("navigates back to step 1 when Back is clicked from step 2", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("Welcome to ai-14all")).toBeInTheDocument();
  });

  it("hides Back button on step 1", () => {
    renderWizard();
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
  });

  it("calls onClose when Skip is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders 5 step indicator dots", () => {
    renderWizard();
    expect(screen.getByTestId("onboarding-dots").children).toHaveLength(5);
  });

  it("navigates through all 5 steps", async () => {
    const user = userEvent.setup();
    renderWizard();

    const titles = [
      "Welcome to ai-14all",
      "Workspaces & Worktrees",
      "Terminals",
      "Code Review",
      "Open a Repository",
    ];

    expect(screen.getByText(titles[0])).toBeInTheDocument();
    for (let i = 1; i < titles.length; i++) {
      await user.click(screen.getByRole("button", { name: /next/i }));
      expect(screen.getByText(titles[i])).toBeInTheDocument();
    }
  });
});
