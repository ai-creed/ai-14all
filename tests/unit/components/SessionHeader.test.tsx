import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionHeader } from "../../../src/features/workspace/SessionHeader";

describe("SessionHeader", () => {
  it("renders title, branch name, and changed file count", () => {
    render(
      <SessionHeader title="My Session" branchName="feature-x" changedFileCount={3} />,
    );

    expect(screen.getByText("My Session")).toBeInTheDocument();
    expect(screen.getByText("feature-x")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
