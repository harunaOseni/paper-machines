# M2 generation evidence — 2026-09-05 (Pacific)

Model: `gpt-6-astra`, medium reasoning, maximum 12,000 output tokens, 120-second deadline. Two concurrent cases; no automatic repair or retry within a case. Nine authored drawings across three categories, an ambiguous zigzag and a blank control. Case labels and expected recognition words were never sent to the generator.

| Run (UTC) | Prompt | Valid primary packages | Recognition keyword proxy | Primary latency |
| --- | --- | --- | --- | --- |
| 2026-09-06T06-18-53-319Z | v1, invalid API schema adapter | 0/9 | Not evaluated | 0.15–1.02 s (API errors) |
| 2026-09-06T06-19-29-939Z | v1, fixed adapter | 9/9 | 8/9 | 26.9–60.2 s; median 40.8 s |
| 2026-09-06T06-22-54-889Z | v2-solid | 9/9 | 9/9 | 26.4–62.1 s; median 36.8 s |

Each run is retained under ignored `test/eval/results/<run>/report.json`. Successful runs also retain original PNGs and generated inert object packages. The blank was rejected locally in every run. The ambiguous zigzag produced an explicitly interpreted bent-rod/wire package in both successful runs. These are structural first-pass results, not runtime success rates. No repair pass was performed.

The adapter failure was a missing explicit type on constant/enum schema fields. A regression now checks the provider schema. The first successful generation run over-interpreted some outlines as wires or flattened forms; inspection of returned code and descriptions motivated v2's solid-volume interpretation rule. The v2 run reuses this corpus and is therefore a regression comparison, not a fresh unseen quality benchmark. The original v1 corpus was held out from prompt design; exclusion from model pretraining is not claimed.

Live browser evidence: a new circle drawn through actual pointer events reached `/api/generate` and OpenAI, returning a solid orange-ball description and bounce/squash code with identical source SHA-256 and revision 1. No authored object substitution was used. UI reports generated code separately from pending 3D playback.

Verification: 105 Node tests passed; browser regression checks passed for drawing tools, interrupted strokes, capture, undo/redo digest equality, generation cancel/edit races, desktop/mobile layout and no page errors. Pen/touch are emulated, not physical-device certification. The server startup smoke test verifies UI delivery, API routing and `.env` returning 404. Dependency audit reported no known vulnerabilities at the time of this run.

## Outstanding acceptance gates

Rendered resemblance, actual motion, build/update/dispose correctness, measured geometry/draw-call budgets and disposal behavior have NOT been evaluated for model-generated code. Their scores remain null. Schema/AST lint is not a sandbox and cannot prove safe or bounded execution. M3's isolated runtime must run these packages before M2.2–M2.4 can receive final visual/runtime acceptance. Do not run the saved code in Node or the parent browser to fill this gap. A new held-out corpus should be added after prompt tuning for an unbiased quality estimate.
