# Phase 15 — durable background review

Graphile Worker 0.18.0 runs in a separate Node process against an explicitly installed private queue. The app can enqueue only its own scoped persisted request through a narrow database function; it cannot read or mutate queue internals. Runtime startup does not install schema. Jobs reload current staff ownership, permissions, branch, case version and frozen source fingerprints before acting.

Five isolated database/process scenarios pass: queued work survives a stopped worker; duplicate delivery has one business completion; changed inputs or revoked staff are blocked; failures stop after three attempts and retain owner recovery; graceful interruption and actual SIGKILL crashes recover safely. The pre-registration regression locks the request row and kills a worker with two prefetched jobs, proving both requests retain their consumed attempts and recovery path.

The pinned Graphile implementation locks jobs by pool ID. Its synchronous `pool:create` event fsyncs an ignored pool/PID/hostname registry before fetching work. Recovery reconciles all prefetched requests before unlocking a proven-dead same-host pool. Live PIDs, reused PIDs and permission failures are never assumed dead. Independent review accepted the corrected crash windows with no remaining major findings.

Codex browser review requested a synthetic job and observed `COMPLETE`, one attempt and its sanitized result. Desktop and 390×844 mobile layouts were inspected. Finance and Billing can read status; only authorized preparation staff can request/recover jobs.

Operational limit: this is verified local process recovery. Other-host/unknown registry locks use Graphile's stale-lock behavior; multi-host and whole-machine recovery procedures remain deployment work. No OCR, AI, payer decisions or external messages run in this worker. [Combined evidence](phases-11-15-validation.md).
