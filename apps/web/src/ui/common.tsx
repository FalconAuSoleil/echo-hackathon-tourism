import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { analysis, type ProgressState } from "../lib/worker-client.ts";
import { watchNetwork } from "../lib/network.ts";

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  // Navigateur : navigator.onLine ; APK : plugin natif @capacitor/network (navigator.onLine y reste vrai en mode avion).
  useEffect(() => watchNetwork(setOnline), []);
  return online;
}

export function OfflineBadge() {
  const online = useOnline();
  return (
    <span class={`net ${online ? "online" : "offline"}`} data-testid="net-status" title="Analysis never uses the network">
      <span class="dot" />
      {online ? "Online" : "Offline"}
    </span>
  );
}

export function useModelProgress(): ProgressState {
  const [p, setP] = useState<ProgressState>(analysis.progress);
  useEffect(() => analysis.subscribe(setP), []);
  return p;
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Synthetic({ children = "synthetic" }: { children?: ComponentChildren }) {
  return <span class="badge synthetic">{children}</span>;
}

export const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
export const pct = (x: number): string => `${Math.round(x * 100)} %`;

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Petit magasin observable (état de session partagé entre pages). */
export function createStore<T>(initial: T) {
  let state = initial;
  const subs = new Set<(s: T) => void>();
  return {
    get: () => state,
    set(next: T | ((s: T) => T)) {
      state = typeof next === "function" ? (next as (s: T) => T)(state) : next;
      subs.forEach((s) => s(state));
    },
    use(): T {
      const [s, setS] = useState(state);
      useEffect(() => {
        subs.add(setS);
        setS(state);
        return () => void subs.delete(setS);
      }, []);
      return s;
    },
  };
}
