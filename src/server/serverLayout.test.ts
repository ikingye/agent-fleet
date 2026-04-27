import { describe, expect, it } from "vitest";
import { createApp } from "./http/createApp.js";
import { JsonControlPlaneStore } from "./store/jsonControlPlaneStore.js";
import { StewardRuntime } from "./steward/stewardRuntime.js";
import { CommandWorkerAdapter } from "./workers/commandWorkerAdapter.js";

describe("server module layout", () => {
  it("exposes the main server boundaries from named feature folders", () => {
    expect(createApp).toEqual(expect.any(Function));
    expect(JsonControlPlaneStore.open).toEqual(expect.any(Function));
    expect(StewardRuntime).toEqual(expect.any(Function));
    expect(CommandWorkerAdapter).toEqual(expect.any(Function));
  });
});
