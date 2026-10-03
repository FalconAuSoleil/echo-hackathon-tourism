# tools/datasets — public data downloads for the evaluation (build time only, git-ignored output)

| Script | Data | License | Output |
|---|---|---|---|
| `fetch_noise.py` | 48 outdoor clips of ESC-50 (rain, wind, birds, crickets, insects, fire, engine, rooster, hen, cow, dog, footsteps), Freesound source CC0 or CC-BY only | ESC-50: CC BY-NC 3.0 (ESC-10 subset CC BY 3.0); per-clip source license + author recorded | `datasets/noise/esc50/*.wav` + `noise_manifest.json` |
| `mix_noise.py` | mixes that noise into the level-3 synthetic speech at 20, 10, 5 dB SNR | – | `eval/data/generated/audio/snr{20,10,5}/` + `eval/data/audio_manifest.jsonl` (noise fields) |

ESC-50: K. J. Piczak, "ESC: Dataset for Environmental Sound Classification", ACM Multimedia 2015,
https://github.com/karolpiczak/ESC-50, DOI 10.7910/DVN/YDEPUT. Used for non-commercial evaluation only; never
shipped in the app, never committed. Run both through `bash tools/tts/make_eval_audio.sh`.
FLEURS (level 1) download is owned by the evaluation agent.
