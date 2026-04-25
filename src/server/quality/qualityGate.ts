import { randomUUID } from "node:crypto";
import type { CheckRun } from "../../shared/types.js";
import { createCommandRunner, type CommandRunner } from "../services/commandRunner.js";

export interface QualityCommand {
  name: string;
  command: string;
}

export interface QualityGateInput {
  taskId: string;
  repositoryRoot: string;
  commands: QualityCommand[];
}

export interface QualityGateResult {
  passed: boolean;
  checks: CheckRun[];
}

export class QualityGate {
  constructor(private runner: CommandRunner = createCommandRunner()) {}

  async run(input: QualityGateInput): Promise<QualityGateResult> {
    if (input.commands.length === 0) {
      return {
        passed: true,
        checks: [
          {
            id: randomUUID(),
            taskId: input.taskId,
            name: "Quality commands",
            command: "",
            status: "unavailable",
            output: "No quality commands configured",
            createdAt: new Date().toISOString()
          }
        ]
      };
    }

    const checks: CheckRun[] = [];

    for (const qualityCommand of input.commands) {
      const result = await this.runner.run("sh", ["-lc", qualityCommand.command], {
        cwd: input.repositoryRoot
      });

      checks.push({
        id: randomUUID(),
        taskId: input.taskId,
        name: qualityCommand.name,
        command: qualityCommand.command,
        status: result.exitCode === 0 ? "passed" : "failed",
        output: `${result.stdout}${result.stderr}`,
        createdAt: new Date().toISOString()
      });
    }

    return {
      passed: checks.every((check) => check.status !== "failed"),
      checks
    };
  }
}
