import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProviderLogo } from "../../../src/features/terminals/components/ProviderLogo";
import { AGENT_PROVIDER_IDS } from "../../../shared/models/agent-provider";

describe("ProviderLogo", () => {
	it.each(AGENT_PROVIDER_IDS)("renders a tinted svg glyph for %s", (id) => {
		render(<ProviderLogo provider={id} />);
		const el = screen.getByTestId(`provider-logo-${id}`);
		expect(el.querySelector("svg")).not.toBeNull();
		expect(el.style.color).toContain("var(--provider-");
	});
});
