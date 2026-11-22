# How the Radar was run

The scripts exactly as they ran on 22 Nov 2026 (paths are the machine's own):

1. `search-open.mjs`: open Dependabot/Renovate PRs that bump a risky frontend package across a major (read-only GitHub search).
2. `search-controls.mjs`: bumps of the same packages that were merged and never reverted (the controls).
3. `prebuild.mjs`: free pre-check, no Kane. Does the **base** app build and render without a backend? The bump is never screenshotted, so cases are not picked by whether they break.
4. `run.mjs` / `queue.sh`: `bumpgate init` on base, commit the kept journeys locally, apply the PR's exact diff, `bumpgate check`. Nothing is pushed or commented upstream; outside install scripts stay off.
5. `aggregate.mjs`: builds `../RESULTS.md` and `../results.json`, re-deciding every journey with the current `src/gate.mjs`.
