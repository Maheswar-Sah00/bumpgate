# Bumpgate

**Dependabot says CI is green. Kane CLI checks the app still works, and the bump merges only if it does.**

On every Dependabot or Renovate PR, Bumpgate builds `main` and the bump side by side and has [Kane CLI](https://www.testmuai.com/kane-cli/) replay your app's critical journeys (plain English, in `.kane/*_test.md`) in a real browser on both. A plain-code rule decides: **every journey that passes on main must pass on the bump.** If one breaks, Claude Code migrates the code from Kane's evidence and the package's release notes, code checks the diff, and Kane re-verifies. Three tries, then a human.

Built for the [Kane CLI Hackathon](https://www.kaneclihack.sh/) by TestMu AI. Agent: **Claude Code** (Codex also supported).

## Judges: start here

| What | Where | Time |
|---|---|---|
| Real Dependabot PRs going through the gate: two blocked, migrated by Claude Code and merged; one green auto-merge | [bumpgatedemo pull requests](https://github.com/Maheswar-Sah00/bumpgatedemo/pulls?q=is%3Apr) | 2 min |
| **Radar:** Bumpgate on 10 *open* Dependabot PRs in other people's repos. 2 blank pages caught, 1 UI drift flagged amber, 7 correctly green. 0 false alarms on 4 bumps that were merged and never reverted | [`radar/RESULTS.md`](radar/RESULTS.md) | 2 min |
| Backtest on real upgrades public repos had to undo: a React PR passed all 4 CI checks, including the deploy to GitHub Pages, and left the app blank, and Kane blocked it at step 1 | [`backtest/RESULTS.md`](backtest/RESULTS.md) | 1 min |
| The merge rule, in code (no prompt decides a merge) | [`src/gate.mjs`](src/gate.mjs) and its tests in [`test/gate.test.mjs`](test/gate.test.mjs) | 1 min |
| The guardrails the fix agent cannot get past | [`src/fix.mjs`](src/fix.mjs) (`guardrails`) | 1 min |
| Run it yourself | [below](#run-it-yourself) | 5 min |
| Site with an animated walkthrough | [maheswar-sah00.github.io/bumpgate](https://maheswar-sah00.github.io/bumpgate/) | 1 min |

## Check our claims

Every number on this page and the site comes from a real Kane CLI run. Here is where to check each one.

| Claim | Evidence | Check it yourself |
|---|---|---|
| zod 3→4 broke the demo shop's checkout (`error.errors` is gone in zod 4); Claude Code migrated it and Kane re-verified 3/3 | [bumpgatedemo #4](https://github.com/Maheswar-Sah00/bumpgatedemo/pull/4): Bumpgate's comment with the base and bump screenshots, the fix commit and its commit status | `bumpgate check --base main --head origin/dependabot/npm_and_yarn/zod-4.6.7` in the demo repo |
| react-query 4→5 blanked the whole shop; migrated and re-verified | [bumpgatedemo #6](https://github.com/Maheswar-Sah00/bumpgatedemo/pull/6) | same, on the react-query branch |
| A safe bump merges itself | [bumpgatedemo #5](https://github.com/Maheswar-Sah00/bumpgatedemo/pull/5) (clsx 1→2, green, auto-merged) | |
| An open react 19 PR in [wfh45678/radar](https://github.com/wfh45678/radar) (1.6k★) ships a blank login page | [radar/cases/radar-react](radar/cases/radar-react/): the journeys `init` wrote, base and bump screenshots, the PR comment Bumpgate would post | Check out [PR #112](https://github.com/wfh45678/radar/pull/112), `cd frontend && npm ci --legacy-peer-deps && npm run build`, open `dist/`: blank page, `ReactCurrentBatchConfig` in the console |
| A UI-kit major (MUI 7→9) moved the UI under a journey without breaking it: amber, not red | [radar/cases/szakal-2-material](radar/cases/szakal-2-material/) | [szakal-2 #503](https://github.com/AeTher97/szakal-2/pull/503) |
| 0 false alarms on 4 bumps that were merged and never reverted | [Controls table](radar/RESULTS.md#controls-bot-bumps-that-were-merged-and-never-reverted) | Each control links to its merged PR |
| `bumpgate init` writes journeys for code it has never seen: 42 drafted, 33 kept | [radar/cases/*/journeys](radar/cases/) (parked drafts are `*.draft.md`) | `npx github:Maheswar-Sah00/bumpgate init --agent claude` in any web app |
| A React 19.3.0 bump passed all 4 CI checks and left the app blank (backtest) | [backtest/RESULTS.md](backtest/RESULTS.md) with both screenshots | [tic-tac-toe #36](https://github.com/anis-mondal/tic-tac-toe/pull/36) and its revert |
| No prompt decides a merge | [`src/gate.mjs`](src/gate.mjs), 53 unit tests in [`test/`](test/) | `npm test` |

Kane's raw evidence packs and recordings are not published: they contain the Kane account's identifiers. Screenshots, journeys, verdicts and PR comments are.

## Why this only works on Kane CLI

- **Plain-English journeys survive cosmetic churn.** A UI-kit major renames classes and wraps buttons; a recorded selector script breaks even when the shop works, so teams skip it on bot PRs. A Kane journey ("click Place order, verify the errors are shown") fails on broken behaviour, not on new markup.
- **`testmd run --override-start-url <PR build> --local`** replays the journeys recorded on main against each PR build on localhost, and never writes back to Test Manager, so a heal on the bump can't rewrite main's recording.
- **Kane says when it had to self-heal** (`test_md_adaptive_heal`). A bump that only passes after a heal gets the **amber** light: it works, but the UI moved. Pass/fail alone can't see that.
- **Sealed evidence packs** give the fix agent the failed step, screenshot, console and network logs, and give reviewers the base and bump screenshots side by side in the PR. (Raw packs include the Kane account's email, so they are published only with `publish-packs: true`.) Kane's own bug verdict (`test_md_bug_verdict`) lands in the PR comment.

## The three lights

| Light | Meaning | Action |
|---|---|---|
| 🟢 green | Every journey that passes on main passes on the bump, no heal, no new console errors | auto-merge |
| 🟡 amber | Passes, but Kane had to self-heal a step, or new console errors / failed requests appeared | one look from a maintainer |
| 🔴 red | A journey that passes on main breaks on the bump | blocked → Claude Code migrates → Kane re-verifies → `needs-human` after 3 tries |

Fail-closed rules: if Kane can't run a journey, nothing merges. A journey already broken on main can't block a bump. Disagreeing runs are repeated until two of three agree. Journeys and config are always read from the **base** branch, so a PR can't edit its own exam.

## Install

```yaml
# .github/workflows/bumpgate.yml
name: Bumpgate
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions: { contents: write, pull-requests: write, issues: write, statuses: write }
concurrency: { group: "bumpgate-${{ github.event.pull_request.number }}", cancel-in-progress: true }
jobs:
  gate:
    if: github.event.pull_request.user.login == 'dependabot[bot]' || github.event.pull_request.user.login == 'renovate[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: Maheswar-Sah00/bumpgate@main
        with:
          lt-username: ${{ secrets.LT_USERNAME }}
          lt-access-key: ${{ secrets.LT_ACCESS_KEY }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Dependabot PRs can only read **Dependabot secrets**: add `LT_USERNAME`, `LT_ACCESS_KEY` and `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` with `agent: codex`) under *Settings → Secrets → Dependabot* (or `gh secret set NAME --app dependabot`).

Then write your journeys, or let Bumpgate draft them:

```bash
npx github:Maheswar-Sah00/bumpgate init --agent claude  # agent drafts 3 journeys; only the ones Kane passes on main are kept
```

Optional `bumpgate.config.json` (read from the base branch):

```json
{
  "journeys": ".kane",
  "appDir": "",
  "serve": { "type": "static", "dir": "dist", "spa": true },
  "amber": "review",
  "agent": "claude",
  "maxFixAttempts": 3,
  "kane": { "timeout": 300, "maxSteps": 30, "maxRuns": 24 }
}
```

Install and build commands are detected from the lockfile and `package.json` (Vite, CRA, Next.js, Astro, Angular, SvelteKit); `serve` can also be `{ "type": "cmd", "cmd": "npm start -- --port $PORT" }`.

## Run it yourself

Needs Node 20+, Chrome and `kane-cli` (`npm i -g @testmuai/kane-cli`, then `kane-cli login`).

```bash
git clone https://github.com/Maheswar-Sah00/bumpgatedemo && cd bumpgatedemo
git fetch origin 'refs/heads/dependabot/*:refs/remotes/origin/dependabot/*'
npx github:Maheswar-Sah00/bumpgate check --base main --head origin/dependabot/npm_and_yarn/zod-4.6.7
# add --fix --agent claude (or codex) to watch the migration loop
```

`bumpgate doctor` checks Kane, the login, git and the agents. The verdict lands in `.bumpgate/verdict.json` and the PR comment in `.bumpgate/comment.md`. Exit codes: `0` green or fixed, `10` amber, `1` red, `3` inconclusive.

## How it works

```
bot PR ─▶ worktrees: base │ bump ─▶ npm ci + build each ─▶ serve on :4319, one side at a time
      ─▶ kane-cli testmd run <journey> --override-start-url --local --agent  (base, then bump)
      ─▶ NDJSON + sealed evidence pack ─▶ gate.mjs: the rule ─▶ 🟢 merge │ 🟡 review │ 🔴 fix loop
fix loop: task = Kane's failed step + screenshot + new console errors + release notes (CHANGELOG / GitHub releases)
      ─▶ Claude Code edits ─▶ guardrails (journeys untouched, bump kept) ─▶ rebuild ─▶ Kane re-runs all journeys
      ─▶ green: commit + push + auto-merge │ still red after 3: label needs-human
```

| File | Job |
|---|---|
| [`src/gate.mjs`](src/gate.mjs) | The rule, majority over re-runs, the three lights |
| [`src/kane.mjs`](src/kane.mjs) | Runs `kane-cli testmd run`, parses its NDJSON stream, isolates each run's recordings |
| [`src/evidence.mjs`](src/evidence.mjs) | Reads failed step, screenshots, console and network from the sealed `.evidence` pack |
| [`src/check.mjs`](src/check.mjs) | Base vs bump session: worktrees, builds, replays, confirmation runs |
| [`src/fix.mjs`](src/fix.mjs), [`src/agent.mjs`](src/agent.mjs) | The closed loop and its code-enforced guardrails |
| [`src/notes.mjs`](src/notes.mjs) | Release notes between the two versions |
| [`src/ci.mjs`](src/ci.mjs), [`action.yml`](action.yml) | The GitHub Action: comment, labels, evidence branch, auto-merge |

Zero runtime dependencies. `npm test` runs the unit tests and an offline end-to-end test of the orchestration ([`test/e2e/stub-kane.mjs`](test/e2e/stub-kane.mjs) stands in for `kane-cli` there; every verdict in this README comes from real Kane runs).

## Honest limits

- Kane runs cost TestMu credits: a recorded replay is cheap, authoring a new journey is not. `kane.maxRuns` caps runs per PR in code.
- Journeys need the app to run without a private backend or login wall (or a seeded preview).
- The fix agent can fail a big major migration. The gate still holds and the PR goes to a human with the evidence.

MIT licensed.
