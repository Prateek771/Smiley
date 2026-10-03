# Production direction checkpoint

Date: 3 October 2026. Baseline: `1d02830`. Scope: direction transition and Phase 20.1; Phases 20–23 remain incomplete.

## Delivered

The staff workspace describes hospital operations, with synthetic data confined to honest test/training records. New rule forms use `CASHLESS-DISCHARGE-1`; historical `SYN-DISCHARGE-1` inputs remain reproducible. Both identifiers use the same existing exact-paise engine. Unknown versions, invalid dates, unsupported inputs and overlapping approved revisions retain their review/denial paths. New manual snapshots use `manual-reviewed`; legacy provenance and immutable assessments remain unchanged. No payer authority is created by an assessment.

The [product direction](../production-direction.md) and [tracker](../../BUILD_PLAN.md) now separate production application setup, data handling/security, deployment/operations and hospital acceptance. Normal staff flows are distinct from `/demo`. Existing sample patient/staff names are retained as test data.

## Verification

- New calculation and registry checks first failed against the old version restriction, then passed with the supported generic version.
- The full local server run exercised 207 checks: 205 passed and two registry checks failed because the initial new test left an overlapping approved rule active. The rule was retired through the application API in the isolated test database; the new test now retires its revision in `finally`. All ten administration checks passed twice consecutively after the repair. The other 197 checks passed in the full run; no checks were skipped. Exact-commit CI provides the complete fresh-database rerun before main promotion.
- Lint, route/TypeScript checks, production compilation and all three served HTTP scenarios passed. Independent code review found no substantive issues.
- Codex browser review confirmed the normal hospital sign-in copy, successful existing staff login, assigned work queue and retained cases. Vercel agent-browser and Playwright were not invoked. Raw screenshots/logs remain private under ignored `tmp/`.
- Native PostgreSQL retained four development cases and three private documents. All twelve applied migration hashes match their saved SQL; no development migration or seed ran for this checkpoint. The earlier owner-requested local password reset is a separate intentional identity change.
- Publication checks found no configured private-value leaks or broken local Markdown links. GitHub history records the resulting commit and exact checks; promotion requires successful CI.

## Remaining production work

The current cloud connector still permits test documents only. Replacing that constraint requires Phase 21 classification, hospital-scoped permission and worker revocation checks, plus an approved handling route. No real documents were transmitted. Source-backed manual workflows remain available.

Seed-free hospital setup, insurer/TPA/policy configuration, applicable rule validation, secure deployment identity/recovery, private storage, backup/restore operations and hospital acceptance remain pending in Phases 20–23. This checkpoint changes the product direction; it does not certify production readiness.
