import { describe, expect, it } from "vitest";
import { parseWorkerFinalReport } from "./workerReportParser.js";

describe("parseWorkerFinalReport", () => {
  it("parses a Markdown-like Worker final report from mixed process output", () => {
    const report = parseWorkerFinalReport([
      "raw stdout before the final answer",
      "# agent-fleet-worker-report-ingestion-202604262151",
      "",
      "Status: DONE_WITH_CONCERNS",
      "",
      "Changed files:",
      "- src/server/workers/workerReportParser.ts",
      "- src/shared/types.ts",
      "",
      "Verification:",
      "- npm test src/server/workers/workerReportParser.test.ts",
      "- npm run typecheck",
      "",
      "Decisions:",
      "- Persist Worker reports as first-class control-plane state.",
      "",
      "Blockers:",
      "- Integration branch still needs a human merge decision.",
      "",
      "Next actions:",
      "- Review the parsed report before merging.",
      "",
      "Needs owner review: yes",
      "Resume id: resume-worker-report-123",
      "Returned ref: refs/heads/agent-fleet/results/agent-fleet-worker-report-ingestion-202604262151",
      "Returned SHA: 0123456789abcdef0123456789abcdef01234567"
    ].join("\n"));

    expect(report).toEqual({
      status: "DONE_WITH_CONCERNS",
      changedFiles: ["src/server/workers/workerReportParser.ts", "src/shared/types.ts"],
      verification: [
        "npm test src/server/workers/workerReportParser.test.ts",
        "npm run typecheck"
      ],
      decisions: ["Persist Worker reports as first-class control-plane state."],
      blockers: ["Integration branch still needs a human merge decision."],
      nextActions: ["Review the parsed report before merging."],
      needsOwnerReview: true,
      resumeId: "resume-worker-report-123",
      returnedRef: "refs/heads/agent-fleet/results/agent-fleet-worker-report-ingestion-202604262151",
      returnedSha: "0123456789abcdef0123456789abcdef01234567",
      markdown: [
        "# agent-fleet-worker-report-ingestion-202604262151",
        "",
        "Status: DONE_WITH_CONCERNS",
        "",
        "Changed files:",
        "- src/server/workers/workerReportParser.ts",
        "- src/shared/types.ts",
        "",
        "Verification:",
        "- npm test src/server/workers/workerReportParser.test.ts",
        "- npm run typecheck",
        "",
        "Decisions:",
        "- Persist Worker reports as first-class control-plane state.",
        "",
        "Blockers:",
        "- Integration branch still needs a human merge decision.",
        "",
        "Next actions:",
        "- Review the parsed report before merging.",
        "",
        "Needs owner review: yes",
        "Resume id: resume-worker-report-123",
        "Returned ref: refs/heads/agent-fleet/results/agent-fleet-worker-report-ingestion-202604262151",
        "Returned SHA: 0123456789abcdef0123456789abcdef01234567"
      ].join("\n")
    });
  });

  it("returns null when output does not contain a final report status", () => {
    expect(parseWorkerFinalReport("Worker accepted prompt\nnpm run check passed")).toBeNull();
  });

  it("normalizes empty list sections and owner review booleans", () => {
    const report = parseWorkerFinalReport([
      "Status: DONE",
      "Changed files: none",
      "Verification:",
      "- npm run check",
      "Blockers: none",
      "Needs owner review: no",
      "Resume id: none"
    ].join("\n"));

    expect(report).toMatchObject({
      status: "DONE",
      changedFiles: [],
      verification: ["npm run check"],
      blockers: [],
      needsOwnerReview: false,
      resumeId: null
    });
  });

  it("parses Markdown heading sections with values on following lines", () => {
    const report = parseWorkerFinalReport([
      "## Status",
      "BLOCKED",
      "## Changed files",
      "none",
      "## Blockers",
      "- Need owner approval before merging.",
      "## Needs owner review",
      "true",
      "## Resume id",
      "resume-heading-report"
    ].join("\n"));

    expect(report).toMatchObject({
      status: "BLOCKED",
      changedFiles: [],
      blockers: ["Need owner approval before merging."],
      needsOwnerReview: true,
      resumeId: "resume-heading-report"
    });
  });
});
