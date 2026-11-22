<!-- bumpgate:v1 -->
### 🟡 Bumpgate · Works, but the UI changed

**`@mui/material 7.3.6 → 9.5.0`**  ·  CI checks that the code builds. **Kane CLI checked that the app still works**: 3 journeys replayed in a real browser on base `952b287` and on this bump `42bd3e6`.

| Journey | Base | This bump | Kane says |
|---|---|---|---|
| Home page shows the login form and links to sign-up and back | ✅ passed | 🟡 passed, changed | Passed only after Kane self-healed a step: the UI changed under the same journey. |
| Forgotten-password link opens the password reset form | ✅ passed | 🟢 passed | Same journey, same result. |
| Sign-up form warns when passwords do not match and clears the warning once they do | ✅ passed | 🟢 passed | Same journey, same result. |

**The rule (code, not a prompt):** every journey that passes on base must pass on the bump → ✅ 3/3 still pass. Not auto-merged: one look from a maintainer, then merge.

> npm refused this bump's dependency tree (@mui/icons-material@7.3.4 conflicts with @mui/material@9.5.0). Bumpgate forced the install with --legacy-peer-deps so Kane could show what a forced install ships.

<details><summary><b>Evidence</b>: what Kane saw, console, network</summary>

**Home page shows the login form and links to sign-up and back**


</details>

<sub>6 Kane runs · Journeys come from the base branch, so a PR cannot edit its own exam · [Bumpgate](https://github.com/Maheswar-Sah00/bumpgate) · verified with [Kane CLI](https://www.testmuai.com/kane-cli/) by TestMu AI</sub>