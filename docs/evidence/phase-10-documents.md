# Phase 10: Private documents and revision-pinned evidence

Status: locally complete; exact application checkpoint CI is recorded in the execution ledger.

## Delivered behavior

Assigned preparation staff upload PDF, PNG, JPEG or UTF-8 text up to 5 MiB. Every upload creates an immutable revision with its own private UUID key, content hash, uploader and time. Original bytes remain downloadable after revisions. Manual source notes retain their exact revision, field/topic, optional page and excerpt; they remain unverified. Billing can read permitted documents; other hospitals, unassigned branches and revoked sessions cannot download them.

The server derives hospital/branch/claim scope and checks current permissions. A case row lock serializes revision numbers. Metadata, case version, event and audit commit together. Exact upload/source retries return the original outcome even after cancellation; changed requests with the same key fail. New writes to cancelled cases fail. Files remain outside `public/` and `.next`; DTOs never expose storage paths or keys.

Downloads recheck scope and stored size/hash, use attachment disposition, `no-store`, `nosniff`, and a sandbox policy. Multipart input has an actual byte cap and rejects duplicate/unknown fields. Plain text rejects executable signatures, binary/invalid UTF-8 and active markup. PNG/JPEG require valid structure and bounded full image decoding rather than MIME labels or metadata alone.

PDF parsing runs in isolated workers: at most two active workers per server process, no waiting queue, a three-second deadline, and V8 heap/stack limits. Pinned, reviewed decoder allocation guards cap one decoded buffer at 16 MiB, cumulative growth allocations at 32 MiB, and object-stream counts before allocation. A maximum eight-filter chain prevents unbounded composed decoder construction. Page trees reject cycles, duplicate nodes, invalid parents/counts, more than 1,000 pages/10,000 nodes or depth 100. Parser warnings are suppressed and workers terminate before their slots are released. Busy requests return 503 with retry guidance; invalid/over-limit content returns 415.

## Verified totals

The fresh production build and complete browser run passed with exit 0. Counts describe separate suites and are not added together.

| Check | Verified result |
| --- | --- |
| Unit/server | 107 passed, zero skips; local run 115.995s |
| Fresh/additive migration preservation | 15 passed, zero skips |
| Production browser journeys | 58 passed: 29 desktop and 29 mobile; 3.7 minutes locally, 1.5 minutes in exact CI |
| Static checks | Lint, typecheck and production build passed |
| Production dependency audit | Zero reported vulnerabilities |
| Final production smoke | Passed in 4.17s with zero client page errors |

## Verification and repairs

- Missing document services produced the expected module-absence RED before activation.
- All 12 real database document checks passed: revision/source pinning, concurrent exact retries, role/tenant/session denials, malformed IDs, storage failure, post-write DB rejection cleanup, tamper detection and cancellation retry semantics.
- Lost-ack browser RED reproduced a request key collision when changed bytes shared filename/size/timestamp. Client retry identity now includes SHA-256 plus filename, MIME, size, purpose and document ID. Unchanged retries retain their key; changed bytes create a new one.
- Strict decoder regressions rejected marker-only/cyclic PDFs, CRC-valid but undecodable PNG, JPEG shells/oversized scans and HTML fragments. Resource regressions reproduced small compressed PDFs expanding beyond 16 MiB, excessive object-stream counts and unbounded concurrent validation before bounded workers were introduced. Direct validator checks accepted valid compressed object streams and recovered after failure/overload; the separate bundled API regression below exposed an additional integration defect.
- Browser assertions now wait for save acknowledgements and completed logout. A multi-login, two-upload journey has a bounded 60-second total deadline after cold compilation exceeded its initial 30-second deadline; individual correctness assertions remain enabled.
- Registration and six-action query journeys also use a 60-second total deadline after traces showed successful writes reaching the original deadline during final navigation/reload. Sign-in helpers wait for the scoped queue heading after the earlier URL transition. Auth evidence captures the viewport: a prior full-page mobile queue capture measured 1,082 × 394,419 pixels and exhausted the journey's time budget. These changes retain every access, persistence and history assertion; cold development timings do not establish production performance.
- Production-mode smoke reproduced valid compressed PDF API uploads returning 415 although direct validator checks passed. Next.js bundling altered raw Uint8Array workerData into an object. The `{ bytes: Uint8Array }` envelope and native `getBuiltinModule("module").createRequire` loader preserve transferable bytes, parser resolution and on-disk hash guards. Native artifact inspection and valid compressed-PDF production smoke against the synthetic development database passed; the complete production browser result is recorded in the verified totals above.
- After the worker-transport fix, the valid compressed-PDF API regression passed on desktop and mobile. That full 54-check browser run finished with 52 passing and two failures: desktop auth navigation and stale-tab refresh. It was a failed checkpoint, not final acceptance.
- Login trace review recorded sign-in POST 200 followed by overlapping push/refresh RSC requests that had not completed when the URL assertion failed. The success path now uses one `window.location.assign('/desk')` navigation, with a single documented Next.js lint exception at this auth-cookie boundary. Credential, session, access and test assertions remain unchanged; the production browser run verified this success path.
- The separate stale-tab trace showed a committed version 2, the expected 409 conflict, and refresh response headers before its body had finished. This was refresh readiness, not a new keyed-form defect. That journey now has a 60-second total budget and waits up to 15 seconds for visible version 2 before the original exact owner/action/due-date assertions, second save and reload checks. The case-action runtime is unchanged; the unchanged field, second-save and reload checks passed in the production browser run.
- A subsequent development-mode trace failed while waiting for the queue heading, before case/document requests. Read-only database diagnostics found no blocked sessions; concurrent workspace reads completed in 1.42–1.63s. A matched production control retained the same test database, actor and 499-case queue without reset: the 1.2MB queue body completed in 2.255s, heading appeared in 2.024s, cases API completed in 1.899s and registration confirmation appeared in 2.068s under the original 5s assertion, with zero page errors. Its captured patient-registration redirect body did not finish; visible confirmation is not proof that every redirect body completed. These controls motivated production-mode regression runs without changing correctness or permission assertions.
- `npm run test:e2e` retains isolated guards, migrations and synthetic domain/auth fixtures, then makes a fresh build and serves production on 3210. CI uses `PLAYWRIGHT_SKIP_BUILD=1` only to reuse its fresh preceding Build step in the same job; `.next/BUILD_ID` is required. No concurrent development/production server or build may share `.next`. The verified totals are recorded above.
- The first production 54-check run ended with 43 passes and 11 failures. Parallel journeys shared the localhost sign-in rate-limit bucket, producing confirmed 429 responses in 2–5ms. A failed login JavaScript chunk also exposed a native credential GET before hydration. Credential-bearing URLs and raw failed traces are excluded from published evidence.
- Server-rendered login controls now remain disabled until hydration, and the form explicitly declares POST. The no-JavaScript regression confirms disabled controls and no native credential GET fields. Test fixtures merge existing headers and assign one client address per journey from the 198.18.0.0/15 benchmark range; browser and request contexts share that address. Production rate limits remain enabled: the regression receives three 401 responses, then 429 with `X-Retry-After` between 1 and 10 seconds. Both regressions passed on desktop/mobile in the complete browser run.
- Production test navigations emitted Gzip drain-listener warnings and one destination-stream-closed observation. No incorrect result was demonstrated, and neither listener limits nor compression were changed. These remain a Next.js streaming investigation. The final production smoke passed with zero client page errors; server streaming observations and client errors are recorded separately.
- Final `npm start` smoke passed in 4.17s: login, persistent draft, real compressed-PDF upload (201), revision-pinned source (200), byte-exact private download (200), fake-PDF rejection (415), logout denial (401), and desktop/mobile layout. It recorded zero client page errors. Four reviewed synthetic production screenshots are archived.

Independent review checked the API/UI/service/storage slice and PDF resource/lifecycle guards. Reviewed synthetic desktop/mobile screenshots are published under `phase-10/`.

The four final production captures show the case and document region on desktop/mobile. Viewport checks verified that the inactive skip link stays above the screen and appears at 16px when focused. Screenshot-only styling hides the inactive link to prevent an offscreen full-page capture artifact; application CSS and keyboard behavior are unchanged. Raw failed traces and session files are excluded.

## Limits and recovery

This is a synthetic local adapter on a trusted workstation. Symlink/path checks and ownership-aware cleanup protect known newly created objects; they do not establish a hostile-host filesystem boundary. Known rollback failures remove only the new owned object. If ownership is uncertain, cleanup preserves the object and reports an aggregate failure. A lost COMMIT acknowledgement preserves bytes because the transaction may have committed; orphan reconciliation is a later provider/operations task.

PDF structure validation and image decoding are not malware scanning, document verification or OCR. Local `npm start` requires the checked-in PDF worker source and pinned dependencies; standalone/cloud packaging and production storage/security remain later deployment work. The server streaming observations above are separate from client page-error checks. No patient data, private file bytes, credentials or browser session state are committed.

Phase 11 adds deterministic, versioned financial assessment. Actual payer authorization/settlement and the Graphile/LangGraph workflow worker follow later phases.

Application checkpoint `d0ead55c450661f753ff1262062a3e139ee5f4d0` passed [exact GitHub CI](https://github.com/Prateek771/Smiley/actions/runs/36859433632) with the locked dependencies and full ephemeral database/browser suite.
