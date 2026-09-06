# Generation evaluation v1

`corpus.mjs` defines nine held-out sketches (three balls/shapes, three creatures, three objects), one ambiguous zigzag, and a blank control. No corpus labels, IDs or expected words are passed to the model. The fixed generation prompt contains no per-case solutions.

Run `node test/eval/run-generation.mjs --live` from the project root with `.env` configured. This makes up to ten paid requests, two at a time, and rejects the blank locally. It records original PNGs, returned inert packages, source digests, model/prompt versions, timing and failures. No automatic repair or silent substitution. Run folders are generated locally and ignored by Git unless explicitly selected for publication.

Rubric for the eventual isolated-render review (each 0–2): recognition (wrong / related / correct), visual resemblance (poor / partial / distinctive silhouette, proportions and colors retained), appropriate motion (broken / generic / subject-appropriate and identity-preserving). Package validity is a boolean; runtime build/update/dispose must be verified separately. `recognitionKeywordMatch` is only a reproducible metadata proxy, not a human recognition or visual score.

Until M3 can safely execute packages, rendered resemblance and runtime-motion scores remain null—not automatic passes. Preserve failures for M3 verification/repair; do not ask users to fix generated code. Animation is not a claim of physical accuracy.

The initial v1 generation run was held out from prompt design. Its wire-sculpture interpretations motivated the v2 solid-volume prompt. Reusing these drawings for v2 is a regression comparison, not a new unseen benchmark. A fresh held-out set is required for an unbiased post-tuning quality estimate.
