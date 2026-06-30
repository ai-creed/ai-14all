import { describe, it, expect } from "vitest";
import { buildSessionReport } from "../../../../services/plugins/samantha/samantha-command-capabilities";
import { createSessionReportProvider } from "../../../../services/plugins/samantha/session-report-provider";
import type { ObserveInput } from "../../../../services/plugins/samantha/observe-types";

const input: ObserveInput = {
  identities: { "wt-1": { repo: "ai-14all", branch: "master", path: "/tmp/wt-1" } },
  reviewCounts: { "wt-1": 2 },
  whisper: [],
  session: null,
};

describe("createSessionReportProvider", () => {
  it("builds a canonical SessionReportResult from injected sources", async () => {
    const provider = createSessionReportProvider({
      getIdentities: async () => input.identities,
      getReviewCount: (id) => input.reviewCounts[id] ?? 0,
      getWhisperStates: async () => input.whisper,
      getSessionSlice: () => input.session,
    });
    const result = await provider();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].reviewCount).toBe(2);
  });

  it("does not drift from the Samantha path (same builder)", async () => {
    const provider = createSessionReportProvider({
      getIdentities: async () => input.identities,
      getReviewCount: (id) => input.reviewCounts[id] ?? 0,
      getWhisperStates: async () => input.whisper,
      getSessionSlice: () => input.session,
    });
    expect(await provider()).toEqual(buildSessionReport(input));
  });
});
