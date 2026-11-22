<!-- bumpgate:v1 -->
### 🔴 Bumpgate · Blocked: the app broke on this bump

**`react 18.3.1 → 19.3.1`**  ·  CI checks that the code builds. **Kane CLI checked that the app still works**: 3 journeys replayed in a real browser on base `7b3090b` and on this bump `e9edefb`.

| Journey | Base | This bump | Kane says |
|---|---|---|---|
| The feedback form refuses an empty message and counts what the player types | ✅ passed | 🔴 broke at step 1 · 2/2 runs | **Open the feedback form**: Riftholm title screen blocked by React runtime exception (major) · new error on this bump: `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')` |
| A player saves their game from the pause menu and can continue it after reloading | ✅ passed | 🔴 broke at step 1 · 2/2 runs | **Start a game**: Riftholm remains on loading screen after startup exception (major) · new error on this bump: `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')` |
| A new player starts a game from the title screen and opens the build catalog | ✅ passed | 🔴 broke at step 1 · 2/3 runs | **Check the title screen**: Title screen remains stuck on loading after React exception (major) · new error on this bump: `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')` |

**The rule (code, not a prompt):** every journey that passes on base must pass on the bump → ❌ 3 broke. Merge blocked.

> npm refused this bump's dependency tree (@react-three/drei@9.122.0 conflicts with react@19.3.1). Bumpgate forced the install with --legacy-peer-deps so Kane could show what a forced install ships.

<details><summary><b>Evidence</b>: what Kane saw, console, network</summary>

**The feedback form refuses an empty message and counts what the player types**

Kane replayed the same recorded steps on both builds (4 replayed, none re-authored). They pass on base and fail on this bump, so the difference comes from the bump.

Kane (confirmed bug): _The game never leaves its loading screen, so the Send Feedback dialog cannot be opened._

Kane's diagnosis: The page hits a JavaScript error while starting up and stays on “Loading Riftholm...” instead of showing the title screen. Fix the startup JavaScript error, then verify that a fresh page load reaches the title screen and exposes Send Feedback.

New console errors on the bump:
```
Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')
```

**A player saves their game from the pause menu and can continue it after reloading**

Kane replayed the same recorded steps on both builds (4 replayed, none re-authored). They pass on base and fail on this bump, so the difference comes from the bump.

Kane (confirmed bug): _The game never leaves the “Loading Riftholm...” screen, so the player cannot start a game._

Kane's diagnosis: The game encounters an error while starting up and remains on its loading screen instead of showing the title screen and Start Game button. Fix the startup error involving ReactCurrentBatchConfig, then verify that a fresh page load reaches the title screen with Start Game or New Game available.

New console errors on the bump:
```
Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')
```

**A new player starts a game from the title screen and opens the build catalog**

Kane replayed the same recorded steps on both builds (4 replayed, none re-authored). They pass on base and fail on this bump, so the difference comes from the bump.

Kane (confirmed bug): _The game never reached its title screen, so the tagline and Start Game button did not appear._

Kane's diagnosis: The page hit a JavaScript error while loading and remained on the “Loading Riftholm...” screen instead of showing the title screen. Fix the loading-time JavaScript error, then confirm that a fresh page load leaves the loading screen and displays both the exact tagline and Start Game button.

New console errors on the bump:
```
Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')
```


</details>

<sub>10 Kane runs · Journeys come from the base branch, so a PR cannot edit its own exam · [Bumpgate](https://github.com/Maheswar-Sah00/bumpgate) · verified with [Kane CLI](https://www.testmuai.com/kane-cli/) by TestMu AI</sub>