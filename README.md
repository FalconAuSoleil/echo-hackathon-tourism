# Echo

*Small AI for Development hackathon (World Bank × Hack-Nation, 3–4 October 2026), Tourism track.*

**THE PROBLEM**
A small rural host, like Noor on her two-hectare coffee farm in Rwanda, welcomes six or seven visitors a month. They leave happy, and she never learns what they liked, what was missing, or what is worth building on. There is no platform, no staff, and often no data plan.

**THE CHANGE**
We did not build a review site. We built a logbook that listens for her. Visitors leave a short voice message in their own language, Echo keeps it, and once a month tells the host, in Kinyarwanda, what to keep and what to fix first.

**THE PROJECT**
Echo is an offline logbook for small rural tourism hosts. It turns voice notes in English, French, German and Spanish into a monthly recap in Kinyarwanda, on a phone the household already owns. No server does any analysis. No accounts, no login.

**THE MAGIC MOMENT**
- A visitor sends a voice note: *"Der Weg war endlos, aber der Kaffee war wunderbar."*
- Echo transcribes it on the phone, splits it into remarks and matches each one to a finding, even with negations ("the walk was not too long" is not "too long")
- Not sure about a remark? Echo never guesses: it flags it "ask a person"
- A topic nobody planned for comes back from three visitors? Echo points at it, without naming it, for a person to read
- At month end, the host gets a recap by SMS on her basic phone, and can listen to it

**HOW IT WORKS**
Visitors share a WhatsApp voice note or text to the farm smartphone. Echo runs there, offline after the first load, and the recap goes to the host's basic phone by SMS, with audio on the smartphone.
- **Whisper base** (quantized, 80 MB) is the ears: transcription and language detection, on the device.
- **paraphrase-multilingual-MiniLM** (135 MB) and a small linear classifier are the judgment: each remark is matched to one of 21 findings, or "not sure", or "off-list".
- **A closed list of frozen Kinyarwanda sentences** is the voice. The host only ever reads or hears 29 catalog sentences with numbers slotted in. Nothing is translated or generated at runtime, so Echo cannot hallucinate to the host.
- **Privacy by construction**: audio is deleted after transcription, names, numbers and e-mails are scrubbed before storage, nothing leaves the phone.
- **A person stays in the loop**: the SMS app opens pre-filled and someone presses Send. Echo never replies to visitors.
- TypeScript, Preact PWA, transformers.js and onnxruntime-web (WebAssembly), Capacitor (side-loadable Android APK), Vite, vitest.
- One pure TypeScript package holds all decision logic and is used by both the app and the evaluation, so the measured numbers are the numbers of the shipped code.

**WHAT WE MEASURED**
On a held-out half of our synthetic written corpus (125 feedbacks, 152 remarks):

| | Echo | Keyword matching (lists written blind) |
|---|---:|---:|
| Remarks captured | 53 % | 80 % |
| Wrong among the answers counted | **6.5 %** | 30 % |
| Cancelling negations handled | **85 %** | 15 % |
| Off-list feedback given a finding | **0 / 15** | 7 / 15 |

Echo captures fewer remarks than keywords on purpose: it says "not sure" instead of guessing, so what it does count is right far more often. Method, confidence intervals and caveats: [`eval/results/RESULTS.md`](eval/results/RESULTS.md).

**HONESTY**
This is a prototype, and parts of it are synthetic or simulated. The evaluation corpus, the test voices, the demo history and the cooperative view are synthetic. The Kinyarwanda is machine-translated and **not validated by a speaker**. The APK was tested on an Android emulator only, never on a real phone or with a real SMS. Every one of these is labelled in the UI and listed in [§12 of the full report](docs/REPORT.md#12-what-is-simulated--synthetic).

**RUN IT**
Node 22 or newer and pnpm 11.
```bash
pnpm install
pnpm models:download     # models go to models/ (git-ignored)
pnpm build && pnpm preview   # http://localhost:4173
pnpm test && pnpm typecheck
```
Visual story: `pnpm --filter @echo/showcase dev` (http://localhost:4180). Android APK: see [`apps/android/README.md`](apps/android/README.md).

**GO FURTHER**
[Full report](docs/REPORT.md) · [Data sheet](docs/DATASHEET.md) · [Architecture](docs/ARCHITECTURE.md) · [Spec (French)](docs/SPEC.md) · [Phone test procedure](docs/MANUAL_TESTS.md) · [Build log](docs/PROGRESS.md)
