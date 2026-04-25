import type { DispatcherStatus } from "../../shared/types.js";

interface RunnableOrchestrator {
  runNext(): Promise<boolean>;
}

export interface AutoDispatcherOptions {
  orchestrator: RunnableOrchestrator;
  intervalMs: number;
  enabled?: boolean;
}

export class AutoDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentRun: Promise<boolean> | null = null;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private lastRunStartedAt: string | null = null;
  private lastRunFinishedAt: string | null = null;
  private lastRunHadTask: boolean | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: AutoDispatcherOptions) {
    this.enabled = options.enabled ?? true;
    this.intervalMs = options.intervalMs;
  }

  start(): void {
    if (!this.enabled || this.timer !== null) {
      return;
    }

    void this.runNow();
    this.timer = setInterval(() => {
      void this.runNow();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer === null) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async runNow(): Promise<boolean> {
    if (this.currentRun !== null) {
      return false;
    }

    this.currentRun = this.runSafely();

    try {
      return await this.currentRun;
    } finally {
      this.currentRun = null;
    }
  }

  status(): DispatcherStatus {
    return {
      enabled: this.enabled,
      running: this.currentRun !== null,
      intervalMs: this.intervalMs,
      lastRunStartedAt: this.lastRunStartedAt,
      lastRunFinishedAt: this.lastRunFinishedAt,
      lastRunHadTask: this.lastRunHadTask,
      lastError: this.lastError
    };
  }

  private async runSafely(): Promise<boolean> {
    this.lastRunStartedAt = new Date().toISOString();
    this.lastRunFinishedAt = null;

    try {
      const ran = await this.options.orchestrator.runNext();
      this.lastRunHadTask = ran;
      this.lastError = null;
      return ran;
    } catch (error) {
      this.lastRunHadTask = null;
      this.lastError = error instanceof Error ? error.message : "Auto dispatcher run failed.";
      return false;
    } finally {
      this.lastRunFinishedAt = new Date().toISOString();
    }
  }
}
