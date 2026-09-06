# Sketch generation

`npm start` loads the ignored project `.env`. Set `OPENAI_API_KEY` there; optionally set `OPENAI_MODEL` (default `gpt-6-astra`). Never put credentials in `public/` or commit `.env`.

The browser captures an opaque 800 × 800 PNG. `POST /api/generate` verifies decoded pixels, SHA-256 and source ID before using the OpenAI Responses API. The service owns provenance fields; model output cannot replace them. The default model supports image inputs and structured output: https://developers.openai.com/api/docs/models/gpt-6-astra.

Limits: 4 MiB PNG, 6 MiB request, 1 MiB provider response, 12,000 output tokens, 120-second provider deadline, 2 concurrent generations, 12 requests per 10 minutes per local server. No automatic paid retries. Cancellation disconnects and aborts the upstream request; charges already incurred may still apply. Same-origin JSON and a custom header are required; only localhost/127.0.0.1 hosts are accepted. This is a loopback-only service, not a publicly deployable authenticated API.

Personal sketches and responses are held in memory for the request/browser session, with no app database, image logs, or disk cache. Moving back to drawing or editing discards the browser's current result and aborts its request. The API receives the sketch when Bring to life is pressed. `store:false` is set, but this is not a promise of zero provider retention. OpenAI's abuse-monitoring retention and applicable exceptions still apply: https://developers.openai.com/api/docs/guides/your-data.

The service returns the existing object contract, with a synchronous factory body returning `root`, `update`, and `dispose`. Model instructions require host timing, bounded geometry, deterministic rest poses, disposal, inferred depth and animation (not a physics claim). Schema validation and AST lint are structural checks, not a security boundary or proof that hooks work. Code remains inert until M3's isolated executor; do not evaluate it in Node or the parent browser.

Evaluation scripts use a fixed, versioned held-out drawing corpus, never substitute sample objects, and report first-pass results and failures. Rendered resemblance and runtime motion scores remain unverified until isolated M3 execution is available. No required user code repair.
