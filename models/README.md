# models/ (git-ignored)

Model files are downloaded here by `pnpm models:download` (see `tools/scripts/download-models.mjs`),
in the Hugging Face layout `models/<org>/<name>/...`, so that transformers.js loads them with
`env.localModelPath` pointing at this folder and `env.allowRemoteModels = false`.

The web app serves this folder from its own origin at `/models/` (dev server and build), so the
files can be side-loaded (copied by USB / SD card) instead of being fetched from the Hugging Face hub.
