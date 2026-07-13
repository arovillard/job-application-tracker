# Fresh-Agent Application Readiness Goal Ledger

## Native Goal

- Objective: Implement the approved Fresh-Agent Application Readiness specification and plan end to end, including reviews, verification, privacy checks, and fresh-context acceptance evidence.
- Budget: none specified.
- Status: active.
- Worktree: `<isolated-worktree>/application-readiness-agent`
- Branch: `codex/application-readiness-agent`
- Approved spec: `docs/specs/fresh-agent-application-readiness.md` at `d2aef97`
- Approved plan: `docs/plans/fresh-agent-application-readiness.md` at `d2aef97`
- Baseline: 68 test files, 564 tests passed before implementation.

## Task Status

| Task | Dependencies | Owner | Write set | Status | Tests | Review |
|---|---|---|---|---|---|---|
| AR-1 | None | `/root/ar1_worker` | Readiness/config scripts and tests, `.env.example`, `package.json` | complete | 33 focused; full verify 212 tests | Clean re-review; commits `952fc0d`, `01644b0` |
| AR-2 | AR-1 | `/root/ar2_worker` | `scripts/setup-user.mjs`, `scripts/setup-user.test.ts` | complete | 36 focused tests | Approved, 0 findings; commit `9c86042` |
| AR-3 | AR-1 | `/root/agent_evidence` reactivated as worker | Skills, root instructions, workflow/install tests | complete | 9 focused tests; skill validation and parity clean | Clean re-review; commits `a153130`, `66834f4` |
| AR-4 | AR-2, AR-3 | `/root/proposal_review` reactivated as worker | `README.md`, `docs/agent-setup.md`, documentation assertion | complete | 3 focused tests | Approved, 0 findings; commit `ebe5624` |
| AR-5 | AR-1–AR-4 | Root Sol | Verification and bounded final fixes | final re-review pending | 51 focused; 228 full; post-fix build passed | Final fix commit `b4d5555` |

## Decisions

- Use two-stage readiness: deterministic local validation plus host Google Docs access verification.
- Prefer Google Docs; support DOCX/PDF/text fallbacks.
- Keep remote Docs links outside the SQLite artifact model; register a local exported snapshot.
- Pass the readiness result's absolute database and applications paths through every downstream command.
- Block unignored repository-local resume and output paths.
- Separate the restricted agent configuration writer from the trusted setup writer.

## Evidence and Blockers

- Prepare review: no remaining blocking or high-severity findings.
- AR-1 initial commit: `952fc0d`.
- AR-1 review: changes required for output-ignore proof, permission-error status mapping, and mode `0000` preservation.
- AR-1 fix commit: `01644b0`; re-review approved with zero findings.
- AR-2 and AR-3 dispatched concurrently with disjoint approved write sets.
- Collaboration thread cap required reactivating the completed read-only evidence agent for AR-3; it had made no prior writes.
- AR-2 approved with zero findings at `9c86042`.
- AR-3 initial commit `a153130`; fix required for direct resume-skill preflight and exact no-link copy.
- AR-3 fix commit `66834f4`; re-review approved with zero findings.
- AR-4 approved with zero findings at `ebe5624`.
- Full `npm run verify`: lint and typecheck clean; 24 files and 223 tests passed.
- Production `npm run build`: compiled, typechecked, and generated all routes successfully; only the pre-existing multi-lockfile worktree warning appeared.
- Focused feature suite: 5 files and 46 tests passed.
- All three skills validated; Codex and Claude trees are byte-identical.
- Privacy/hygiene: `.env.local`, SQLite, and default applications artifacts are ignored; Git diff is clean; generated `next-env.d.ts` build change was removed.
- Live readiness CLI with Google URL and external applications path returned schema v1 `ready`, external-access check required, and only missing-personal-skill warnings.
- Real custom-database upsert/registration and unsafe custom-output privacy cases pass in automated contract tests.
- Fresh-context scenario traces A–C all passed for missing resume, supplied-link Google success/failure, DOCX/profile warning, PDF warning, direct resume invocation, custom paths, master immutability, and snapshot-before-registration.
- Live private Google Docs create/readback/export was not run because no user-owned test document was supplied; fixture traces are not represented as live connector proof.
- Final review found: direct posting skill preflight gap, symlink privacy containment bypass, path-first root setup copy, and missing stale-installed-skill warnings.
- One consolidated final fix pass dispatched to `/root/ar2_worker` with TDD and full verification required.
- Final fix commit `b4d5555` resolves all four findings with five RED regressions and 35 focused GREEN tests.
- Fresh post-fix `npm run verify`: lint/typecheck clean; 24 files and 228 tests passed.
- Fresh post-fix production build passed; generated `next-env.d.ts` change was removed again.
- Post-fix direct posting scenario D passed: readiness-derived absolute DB path, explicit upsert, verified output, no unintended materials.
- Current blocker: Sol final re-review.
