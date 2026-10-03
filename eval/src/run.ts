// Point d'entrée unique de l'évaluation (SPEC 9) : `pnpm eval`.
// Niveau 1 : WER Whisper sur FLEURS ; niveau 2 : classement sur retours écrits synthétiques ;
// niveau 3 : bout en bout sur audio synthétique bruité. Mêmes modèles (@echo/models) et même code (@echo/core) que l'app.
// Squelette : les niveaux sont écrits par l'agent d'évaluation (voir docs/ARCHITECTURE.md).
console.error("pnpm eval: the evaluation levels are not implemented yet (scaffold). See docs/ARCHITECTURE.md § Evaluation.");
process.exit(2);
