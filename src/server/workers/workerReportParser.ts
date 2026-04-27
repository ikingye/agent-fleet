import type { WorkerReport, WorkerReportStatus } from "../../shared/types.js";

export type ParsedWorkerReport = Omit<WorkerReport, "id" | "goalId" | "workerSessionId" | "createdAt">;

export interface WorkerFinalReportParseOptions {
  expectedWorkerName?: string | null;
}

type SectionName =
  | "status"
  | "changedFiles"
  | "verification"
  | "decisions"
  | "blockers"
  | "nextActions"
  | "needsOwnerReview"
  | "resumeId"
  | "returnedRef"
  | "returnedSha";

const sectionNames = new Map<string, SectionName>([
  ["status", "status"],
  ["changed files", "changedFiles"],
  ["changed file", "changedFiles"],
  ["verification", "verification"],
  ["decisions", "decisions"],
  ["decision", "decisions"],
  ["blockers", "blockers"],
  ["blocker", "blockers"],
  ["next actions", "nextActions"],
  ["next action", "nextActions"],
  ["needs owner review", "needsOwnerReview"],
  ["owner review", "needsOwnerReview"],
  ["resume id", "resumeId"],
  ["resume", "resumeId"],
  ["returned ref", "returnedRef"],
  ["return ref", "returnedRef"],
  ["returned sha", "returnedSha"],
  ["return sha", "returnedSha"]
]);

const listSections = new Set<SectionName>(["changedFiles", "verification", "decisions", "blockers", "nextActions"]);

export function parseWorkerFinalReport(
  output: string,
  options: WorkerFinalReportParseOptions = {}
): ParsedWorkerReport | null {
  const expectedWorkerName = options.expectedWorkerName?.trim();

  if (expectedWorkerName === undefined || expectedWorkerName === "") {
    return null;
  }

  const lines = output.split(/\r?\n/);
  const statusIndex = lines.findIndex((line, index) => {
    const section = parseSectionLine(line);
    return (
      section?.name === "status" &&
      (parseStatus(section.value) !== null || findFollowingStatus(lines, index) !== null)
    );
  });

  if (statusIndex === -1) {
    return null;
  }

  const startIndex = findReportStart(lines, statusIndex, expectedWorkerName);

  if (startIndex === null) {
    return null;
  }

  const reportLines = lines.slice(startIndex);
  const markdown = reportLines.join("\n").trimEnd();
  const report = emptyReport(markdown);
  let currentSection: SectionName | null = null;

  for (const line of reportLines) {
    const parsedSection = parseSectionLine(line);

    if (parsedSection !== null) {
      currentSection = parsedSection.name;
      applySectionValue(report, parsedSection.name, parsedSection.value);
      continue;
    }

    if (currentSection === null || line.trim() === "") {
      continue;
    }

    applySectionValue(report, currentSection, line);
  }

  return report.status === null
    ? null
    : {
        ...report,
        status: report.status,
        changedFiles: normalizeList(report.changedFiles),
        verification: normalizeList(report.verification),
        decisions: normalizeList(report.decisions),
        blockers: normalizeList(report.blockers),
        nextActions: normalizeList(report.nextActions),
        resumeId: normalizeScalar(report.resumeId),
        returnedRef: normalizeScalar(report.returnedRef),
        returnedSha: normalizeScalar(report.returnedSha)
      };
}

interface DraftReport extends Omit<ParsedWorkerReport, "status"> {
  status: WorkerReportStatus | null;
}

function emptyReport(markdown: string): DraftReport {
  return {
    status: null,
    changedFiles: [],
    verification: [],
    decisions: [],
    blockers: [],
    nextActions: [],
    needsOwnerReview: false,
    resumeId: null,
    returnedRef: null,
    returnedSha: null,
    markdown
  };
}

function findReportStart(lines: string[], statusIndex: number, expectedWorkerName: string): number | null {
  for (let index = statusIndex - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();

    if (line === "") {
      continue;
    }

    return isWorkerNameHeading(line, expectedWorkerName) ? index : null;
  }

  return null;
}

function isWorkerNameHeading(line: string, expectedWorkerName: string): boolean {
  const markdownHeading = /^(?:#{1,6}\s+)(.+?)\s*$/.exec(line);
  const headingText = markdownHeading?.[1] ?? line;

  return headingText.trim() === expectedWorkerName;
}

function parseSectionLine(line: string): { name: SectionName; value: string } | null {
  const trimmed = line.trim();
  const match = /^(?:#{1,6}\s*)?([A-Za-z][A-Za-z ]+?)\s*:\s*(.*)$/.exec(trimmed);

  if (match === null) {
    const headingMatch = /^#{1,6}\s+([A-Za-z][A-Za-z ]+?)\s*$/.exec(trimmed);

    if (headingMatch === null) {
      return null;
    }

    const sectionName = sectionNames.get(headingMatch[1].trim().toLowerCase());
    return sectionName === undefined ? null : { name: sectionName, value: "" };
  }

  const sectionName = sectionNames.get(match[1].trim().toLowerCase());

  if (sectionName === undefined) {
    return null;
  }

  return { name: sectionName, value: match[2].trim() };
}

function findFollowingStatus(lines: string[], statusHeadingIndex: number): WorkerReportStatus | null {
  for (let index = statusHeadingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line === "") {
      continue;
    }

    if (parseSectionLine(line) !== null) {
      return null;
    }

    return parseStatus(stripListMarker(line));
  }

  return null;
}

function applySectionValue(report: DraftReport, section: SectionName, rawValue: string): void {
  const value = stripListMarker(rawValue);

  if (value === "") {
    return;
  }

  if (section === "status") {
    report.status = parseStatus(value);
    return;
  }

  if (section === "needsOwnerReview") {
    report.needsOwnerReview = parseBoolean(value);
    return;
  }

  if (section === "resumeId") {
    report.resumeId = value;
    return;
  }

  if (section === "returnedRef") {
    report.returnedRef = value;
    return;
  }

  if (section === "returnedSha") {
    report.returnedSha = value;
    return;
  }

  if (listSections.has(section)) {
    report[section].push(value);
  }
}

function parseStatus(value: string): WorkerReportStatus | null {
  const normalized = value.trim().toUpperCase();

  if (normalized === "DONE" || normalized === "DONE_WITH_CONCERNS" || normalized === "BLOCKED") {
    return normalized;
  }

  return null;
}

function parseBoolean(value: string): boolean {
  return /^(yes|true|y|required|needs review)$/i.test(value.trim());
}

function normalizeList(values: string[]): string[] {
  return values.map(stripListMarker).filter((value) => value !== "" && !isNone(value));
}

function normalizeScalar(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = stripListMarker(value);
  return normalized === "" || isNone(normalized) ? null : normalized;
}

function stripListMarker(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function isNone(value: string): boolean {
  return /^(none|n\/a|no changes?)$/i.test(value.trim());
}
