# Radar: Bumpgate on open bot PRs in other people's repos

**10 open Dependabot PRs checked end to end: 2 red, 7 green, 1 amber. 4 control bumps that were merged and never reverted: 0 false alarms.**

Nothing here was planted. Each repo is someone else's public app; we never pushed to it or commented on it.

## How each case was run

1. **`bumpgate init`** on the PR's base commit: Claude Code read the app's code and drafted journeys; Kane recorded each one and kept only those that pass on base. Drafts it could not pass are parked, not kept.
2. The kept journeys were committed on a local copy of base (never pushed), and the bot PR's exact diff applied on top.
3. **`bumpgate check`** built both sides, Kane replayed every journey on each, and Bumpgate's rule decided. A failure on the bump is confirmed with another run.
4. Cases were chosen only on whether the base app runs without a backend; the bump was not looked at first, and every case that reached Kane is listed below, greens included.

## Open bot PRs

| | Repo · PR | Upgrade | Journeys | What Kane saw |
|---|---|---|---|---|
| 🔴 | [wfh45678/radar #112](https://github.com/wfh45678/radar/pull/112) · 1,622★ | `react` 18.3.1 → 19.3.1 | 3 broke | Kane: *"Login page fails to render after home navigation"* (major). Console: `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')`. npm itself refused this tree (react@19.3.1 conflicts with its peers) and the PR's own CI is red; a forced install (`--legacy-peer-deps`) ships this. [screenshots](cases/radar-react/shots/) |
| 🔴 | [Box47-games/voxel-rpg-game #606](https://github.com/Box47-games/voxel-rpg-game/pull/606) | `react` 18.3.1 → 19.3.1 | 2 broke, 1 inconclusive | Kane: *"Riftholm title screen blocked by React runtime exception"* (major). Console: `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')`. npm itself refused this tree (@react-three/drei@9.122.0 conflicts with react@19.3.1) and the PR's own CI is red; a forced install (`--legacy-peer-deps`) ships this. [screenshots](cases/voxel-rpg-game-react/shots/) |
| 🟢 | [y33tkid/3D507 #13](https://github.com/y33tkid/3D507/pull/13) | `zustand` 4.5.5 → 5.1.0 | 2 same | Every journey behaves the same. |
| 🟢 | [bernhardmayr/Uhrenheld #21](https://github.com/bernhardmayr/Uhrenheld/pull/21) | `zustand` 4.5.7 → 5.1.0 | 1 same | Every journey behaves the same. |
| 🟢 | [Vijay-3812/AlgoVerse #17](https://github.com/Vijay-3812/AlgoVerse/pull/17) | `zustand` 4.5.7 → 5.1.0 | 2 same | Every journey behaves the same. |
| 🟢 | [binwiederhier/ntfy #2206](https://github.com/binwiederhier/ntfy/pull/2206) · 35,682★ | `react-i18next` 17.1.13 → 18.0.1 | 3 same | Every journey behaves the same. |
| 🟢 | [thinkwee/HiMe #66](https://github.com/thinkwee/HiMe/pull/66) · 73★ | `react-i18next` 14.1.3 → 17.0.15 | 2 same | Every journey behaves the same. |
| 🟢 | [crbzxy/edmox #10](https://github.com/crbzxy/edmox/pull/10) | `@mui/material` 6.5.0 → 9.5.0 | 2 same | Every journey behaves the same. |
| 🟢 | [javirs200/AssettoSesionViwer #18](https://github.com/javirs200/AssettoSesionViwer/pull/18) | `@mui/material` 5.18.0 → 9.5.0 | 3 same | Every journey behaves the same. |
| 🟡 | [AeTher97/szakal-2 #503](https://github.com/AeTher97/szakal-2/pull/503) | `@mui/material` 7.3.6 → 9.5.0 | 1 amber, 2 same | Works, but the UI moved: Kane replayed *"Home page shows the login form and links to sign-up and back"* cleanly on main and passed it on the bump only after self-healing a step. One look before merging. npm also refused the tree (@mui/icons-material@7.3.4 conflicts with @mui/material@9.5.0). |

## Controls: bot bumps that were merged and never reverted

| | Repo · PR | Upgrade | Merged | Journeys same |
|---|---|---|---|---|
| 🟢 | [marabesi/json-tool #175](https://github.com/marabesi/json-tool/pull/175) | `react-icons` 4.12.0 → 5.7.0 | 2026-09-07 | 2/2 same |
| 🟢 | [skatcat31/cline-todo #11](https://github.com/skatcat31/cline-todo/pull/11) | `@mui/material` 7.3.11 → 9.3.1 | 2026-08-29 | 2/2 same |
| 🟢 | [LeeAdcock/robocodeJs.com #36](https://github.com/LeeAdcock/robocodeJs.com/pull/36) | `react-icons` 4.7.1 → 5.7.0 | 2026-07-06 | 2/2 same |
| 🟢 | [VanillaIceCube/Notoli #748](https://github.com/VanillaIceCube/Notoli/pull/748) | `@mui/material` 7.3.9 → 9.4.0 | 2026-10-10 | 3/3 same |

## Open bot PRs that do not even build

Bumpgate blocks these before Kane runs. Most of these repos' own CI already fails on them; it is listed for completeness, not as a Kane result.

- [YUHUANGSHANDIAN/WealthGrowthTracker #21](https://github.com/YUHUANGSHANDIAN/WealthGrowthTracker/pull/21): `zustand` 4.5.7 → 5.1.0 fails at build
- [Soarezzsemj/StackStudy #17](https://github.com/Soarezzsemj/StackStudy/pull/17): `react-i18next` 15.2.0 → 18.0.2 fails at build
- [MIKE08-CODE/Quincaillerie-Laurentienne-Projet-A #47](https://github.com/MIKE08-CODE/Quincaillerie-Laurentienne-Projet-A/pull/47): `react-i18next` 15.7.4 → 18.0.2 fails at build
- [ductran1302/hrms #16](https://github.com/ductran1302/hrms/pull/16): `antd` 5.29.3 → 6.6.7 fails at build
- [TheMRVX/sarab #43](https://github.com/TheMRVX/sarab/pull/43): `@mui/material` 6.5.0 → 9.5.0 fails at build
- [lithastra/kubeatlas #107](https://github.com/lithastra/kubeatlas/pull/107): `@mui/material` 5.18.0 → 9.5.0 fails at build
- [Cruzyhubby/e-card #7](https://github.com/Cruzyhubby/e-card/pull/7): `tailwindcss` 3.4.19 → 4.3.5 fails at build

## `bumpgate init` on code it had never seen

Claude Code drafted **42** journeys across these apps; Kane kept **33** that pass on base and parked the rest for a human. Every journey file is in [cases/](cases/), parked drafts as `*.draft.md`.

## What running on strangers' repos fixed in Bumpgate

Our demo shop never hit these. Each one was found here, fixed, tested and re-applied to the results above:

- Recording a 4-step journey takes longer than the old flat 7-minute limit, which killed real recordings mid-run; the limit now scales with the steps ([650c9f2](https://github.com/Maheswar-Sah00/bumpgate/commit/650c9f2)).
- Vite apps that build to `build/` or serve under a GitHub Pages path (`base: '/repo/'`) are detected; local `check` reads config from the base commit like CI; an unset CLI flag no longer erases it; a peer-dependency conflict on the bump is reported, not silently forced ([88c5f5d](https://github.com/Maheswar-Sah00/bumpgate/commit/88c5f5d)).
- Kane can carry a URL from one session into another. A run that wanders into a different local app is counted as a run error and re-run, never as a broken journey ([d6c5325](https://github.com/Maheswar-Sah00/bumpgate/commit/d6c5325)). One voxel-rpg-game journey is inconclusive for this reason.
- A self-heal is drift only when base replayed cleanly. One control needed a heal on base too; it is green, not amber ([b27cb7b](https://github.com/Maheswar-Sah00/bumpgate/commit/b27cb7b)).

## Limits

- A small sample, picked from apps that run without a backend, login or database.
- Journeys come from `init` and cover what a visitor can reach without an account.
- Kane checks what a user can do, not pixels: a pure styling regression can pass.
- Kane's raw evidence packs and recordings are not published: they contain the Kane account's identifiers.
