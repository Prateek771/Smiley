# Phase 3 desk validation

The `/demo` queue/detail journey uses five fictional Phase 2 packs. These are checkpoint-scoped expected outcomes, not a live rule engine or actual insurer decisions. Demo role controls grant no access.

Tests first failed against the absent routes. After implementation, **18/18 Playwright tests passed** on desktop Chromium and Pixel 7: queue/case/back context, filter/search/role persistence, missing facts, query and document cutoffs, actual authorization distinction, empty/error/loading recovery, and responsive navigation. Final lint and typecheck passed. Production build is checked before committing; the exact GitHub run is recorded in the execution ledger after dispatch.

Agent-browser inspected queue and P2-03 query-2 detail at 1440×1000 and 390×844. Both sessions had empty browser error logs and were closed. Screenshots were visually reviewed for overflow and usable navigation:

- [Desktop queue](phase-3/queue-desktop.png)
- [Mobile queue](phase-3/queue-mobile.png)
- [Desktop detail](phase-3/case-desktop.png)
- [Mobile detail](phase-3/case-mobile.png)

The fixture evidence remains synthetic. Authentication, database scope and persisted actions are subsequent phases.
