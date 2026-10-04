# Previous evaluation results (kept for transparency)

`2026-10-04-before-recall/`: the results committed in 08147a7, before the recall work (catalog of 756 examples,
probability threshold 0.84, off-list floor 0.59, selection rule ≤ 5 % error / ≥ 85 % cancelling negations) and with
the original keyword lists as the only headline baseline. Held-out half: Echo 48.0 % of remarks captured, 6.0 % of
accepted answers wrong; keywords (original lists) 87.5 % / 27.8 %. Level 3 at 10 dB (whisper-base): Echo 35.2 % / 2.7 %.

Files: `RESULTS.md`, `level2.json`, `thresholds.json`, `perf.json`, `pii.json` as they were. The full `level3.json` and
the curve are in git history (`git show 08147a7:eval/results/level3.json`). Level 1 (FLEURS) did not change.
