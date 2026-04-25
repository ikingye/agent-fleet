import { describe, expect, it } from "vitest";
import { AutoDispatcher } from "./autoDispatcher.js";

class StubOrchestrator {
  calls = 0;
  results: boolean[] = [];

  constructor(results: boolean[]) {
    this.results = [...results];
  }

  async runNext(): Promise<boolean> {
    this.calls += 1;
    return this.results.shift() ?? false;
  }
}

describe("AutoDispatcher", () => {
  it("runs queued work automatically after start", async () => {
    const orchestrator = new StubOrchestrator([true]);
    const dispatcher = new AutoDispatcher({ orchestrator, intervalMs: 1000 });

    dispatcher.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    dispatcher.stop();

    expect(orchestrator.calls).toBeGreaterThan(0);
    expect(dispatcher.status().enabled).toBe(true);
    expect(dispatcher.status().lastRunHadTask).toBe(true);
  });

  it("does not overlap orchestrator runs", async () => {
    let releaseRun: ((value: boolean) => void) | null = null;
    const orchestrator = {
      calls: 0,
      async runNext(): Promise<boolean> {
        this.calls += 1;
        return new Promise<boolean>((resolve) => {
          releaseRun = resolve;
        });
      }
    };
    const dispatcher = new AutoDispatcher({ orchestrator, intervalMs: 5 });

    const firstRun = dispatcher.runNow();
    const skippedRun = dispatcher.runNow();

    expect(orchestrator.calls).toBe(1);
    expect(await skippedRun).toBe(false);

    releaseRun?.(true);

    expect(await firstRun).toBe(true);
    expect(dispatcher.status().running).toBe(false);
  });
});
