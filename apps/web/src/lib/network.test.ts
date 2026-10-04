import { describe, expect, it } from "vitest";
import { watchNetwork, type NetworkPlugin } from "./network.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("network status for the Online/Offline badge", () => {
  it("in the browser follows navigator.onLine and the online/offline events", () => {
    const handlers: Record<string, () => void> = {};
    const seen: boolean[] = [];
    const stop = watchNetwork((o) => seen.push(o), {
      navigator: { onLine: true },
      addEventListener: (t, cb) => (handlers[t] = cb),
      removeEventListener: (t) => delete handlers[t],
    });
    handlers.offline!();
    handlers.online!();
    expect(seen).toEqual([true, false, true]);
    stop();
    expect(Object.keys(handlers)).toEqual([]);
  });

  it("inside Capacitor uses the native plugin, not navigator.onLine (true in the WebView in airplane mode)", async () => {
    let listener: ((s: { connected: boolean }) => void) | null = null;
    let removed = false;
    const plugin: NetworkPlugin = {
      getStatus: async () => ({ connected: false }),
      addListener: async (_e, cb) => {
        listener = cb;
        return { remove: () => void (removed = true) };
      },
    };
    const seen: boolean[] = [];
    const stop = watchNetwork((o) => seen.push(o), { Capacitor: { isNativePlatform: () => true }, navigator: { onLine: true } }, async () => plugin);
    await tick();
    expect(seen).toEqual([false]);
    listener!({ connected: true });
    expect(seen).toEqual([false, true]);
    stop();
    expect(removed).toBe(true);
    listener!({ connected: false });
    expect(seen).toEqual([false, true]);
  });

  it("falls back to navigator.onLine if the native plugin is missing", async () => {
    const seen: boolean[] = [];
    watchNetwork((o) => seen.push(o), { Capacitor: { isNativePlatform: () => true }, navigator: { onLine: false } }, async () => {
      throw new Error("not implemented on android");
    });
    await tick();
    expect(seen).toEqual([false]);
  });
});
