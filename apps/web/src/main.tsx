import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./styles.css";
import { loadStatic, type StaticData } from "./lib/assets.ts";
import { analysis } from "./lib/worker-client.ts";
import { Demo } from "./pages/Demo.tsx";
import { Host, PinGate } from "./pages/Host.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { Coop } from "./pages/Coop.tsx";
import { Card } from "./pages/Card.tsx";
import { OfflineBadge } from "./ui/common.tsx";
import { shouldAutoStart } from "./ui/ModelBox.tsx";

const ROUTES = [
  { path: "", label: "Try it" },
  { path: "host", label: "Host app" },
  { path: "coop", label: "Cooperative" },
  { path: "card", label: "Visitor card" },
  { path: "settings", label: "Settings" },
];

function useRoute(): string {
  const get = () => location.hash.replace(/^#\/?/, "").split(/[?/]/)[0] ?? "";
  const [route, setRoute] = useState(get());
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function App() {
  const route = useRoute();
  const [data, setData] = useState<StaticData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    loadStatic()
      .then((d) => {
        setData(d);
        if (shouldAutoStart()) void analysis.init().catch(() => undefined);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);
  return (
    <>
      <header class="topbar">
        <span class="name">Echo</span>
        <span class="tag">visit feedback logbook</span>
        <span class="spacer" />
        <OfflineBadge />
      </header>
      <nav class="tabs">
        {ROUTES.map((r) => (
          <a key={r.path} href={`#/${r.path}`} class={route === r.path ? "active" : ""}>
            {r.label}
          </a>
        ))}
      </nav>
      <main>
        {err && <p class="error">Could not load the app data: {err}</p>}
        {!data && !err && <p class="muted">Loading…</p>}
        {data && route === "" && <Demo data={data} />}
        {data && route === "host" && (
          <PinGate>
            <Host data={data} />
          </PinGate>
        )}
        {data && route === "settings" && (
          <PinGate>
            <SettingsPage />
          </PinGate>
        )}
        {data && route === "coop" && (
          <PinGate>
            <Coop data={data} />
          </PinGate>
        )}
        {route === "card" && <Card />}
        <footer class="muted no-print" style={{ fontSize: "0.78rem", margin: "1.5rem 0 1rem" }}>
          Prototype for the Small AI for Development hackathon. Synthetic data and simulated parts are labelled as such. Kinyarwanda
          sentences are machine translated and not yet validated by a speaker.
        </footer>
      </main>
    </>
  );
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

const root = document.getElementById("app");
if (root) render(<App />, root);
