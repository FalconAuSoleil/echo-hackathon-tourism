import { render } from "preact";
import { CATALOG_SCHEMA_VERSION } from "@echo/core";

function App() {
  return (
    <main>
      <h1>Echo</h1>
      <p>Visit feedback logbook. Scaffold only (catalog schema v{CATALOG_SCHEMA_VERSION}).</p>
    </main>
  );
}

const root = document.getElementById("app");
if (root) render(<App />, root);
