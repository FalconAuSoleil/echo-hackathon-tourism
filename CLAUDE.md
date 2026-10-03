# Echo — visit feedback logbook (Small AI for Development hackathon, Tourism track)

Product spec (source of truth): `docs/SPEC.md` (French). Official brief: `docs/hackathon-brief.txt`.
Architecture and module contracts: `docs/ARCHITECTURE.md` (written in the scaffold phase; keep it current).
Build progress log: `docs/PROGRESS.md` — read it first, append what you did, what is left, and any deviation from the spec.

## Hard rules
- All analysis runs on the device. No server does any analysis. No accounts, no login.
- The host only ever sees frozen Kinyarwanda sentences from `catalog/`, with numeric slots. Nothing is translated or generated at runtime for the host.
- "Not sure" chunks are never counted; they are always flagged with "ask a person".
- Never present a simulated feature as real. Anything simulated or synthetic is labelled as such in the UI and in the README.
- Never delete a spec feature silently: log any cut or deviation in `docs/PROGRESS.md`.
- Audio is never persisted after transcription; names, phone numbers and e-mails are scrubbed before storage.

## Conventions
- Jury-facing material (README, demo UI chrome) in English. Host-facing recap in Kinyarwanda with FR/EN glosses shown side by side in the demo.
- Shared analysis logic lives in one TypeScript package used by both the app and the evaluation, so measured numbers are the numbers of the shipped code.
- Tests next to code. Run the test suite and typecheck before considering a task done.
- Python (in `.venv/`) is only for offline build-time tooling (Kinyarwanda generation, TTS for test audio, dataset download). Never needed at runtime.
- Large binaries (models, datasets, generated eval audio) are git-ignored and re-creatable by script; small demo assets (sample audio, catalog audio) are committed.
- Commit locally after each coherent step. Never push, never create a remote, never deploy publicly: that is the user's call.

## Commands
```bash
pnpm install                 # pnpm 11 workspace (packages/core, packages/models, apps/web, eval)
pnpm models:download         # quantized ONNX models into models/ (git-ignored); -- --all adds whisper-small
pnpm smoke:models            # transcribe a synthetic clip + embed sentences with every downloaded model
pnpm test                    # vitest, all packages
pnpm typecheck               # tsc on every package
pnpm dev / pnpm build        # web app (Vite, port 5173)
pnpm eval                    # three-level evaluation (SPEC 9)
```
