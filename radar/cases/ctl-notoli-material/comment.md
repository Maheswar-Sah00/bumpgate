<!-- bumpgate:v1 -->
### 🟢 Bumpgate · Safe to merge

**`2 packages (@mui/material, @mui/icons-material)`**  ·  CI checks that the code builds. **Kane CLI checked that the app still works**: 3 journeys replayed in a real browser on base `cd623d7` and on this bump `a401700`.

| Journey | Base | This bump | Kane says |
|---|---|---|---|
| A user can move between sign-in, password reset and sign-up screens | ✅ passed | 🟢 passed | Same journey, same result. |
| Sign-up form blocks registration when the two passwords do not match | ✅ passed | 🟢 passed | Same journey, same result. |
| A signed-out visitor is sent to the sign-in form and can fill it in | ✅ passed | 🟢 passed | Same journey, same result. |

**The rule (code, not a prompt):** every journey that passes on base must pass on the bump → ✅ 3/3 still pass. Merging automatically.

<sub>6 Kane runs · Journeys come from the base branch, so a PR cannot edit its own exam · [Bumpgate](https://github.com/Maheswar-Sah00/bumpgate) · verified with [Kane CLI](https://www.testmuai.com/kane-cli/) by TestMu AI</sub>