import type { CommandRunner } from "../services/commandRunner.js";

export interface ImportedIssue {
  title: string;
  goal: string;
  url: string;
}

interface GhIssueJson {
  title: string;
  body: string | null;
  url: string;
}

export class GitHubClient {
  constructor(private runner: CommandRunner) {}

  async getIssue(repository: string, issueNumber: number): Promise<ImportedIssue> {
    const result = await this.runner.run(
      "gh",
      ["issue", "view", String(issueNumber), "--repo", repository, "--json", "title,body,url"],
      { cwd: process.cwd() }
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "gh issue view failed");
    }

    const issue = JSON.parse(result.stdout) as GhIssueJson;
    const goal = issue.body?.trim() || issue.title;

    return {
      title: issue.title,
      goal,
      url: issue.url
    };
  }
}
