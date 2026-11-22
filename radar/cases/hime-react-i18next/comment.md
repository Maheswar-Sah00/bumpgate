<!-- bumpgate:v1 -->
### 🟢 Bumpgate · Safe to merge

**`react-i18next 14.1.3 → 17.0.15`**  ·  CI checks that the code builds. **Kane CLI checked that the app still works**: 2 journeys replayed in a real browser on base `d2db722` and on this bump `9dd5817`.

| Journey | Base | This bump | Kane says |
|---|---|---|---|
| Switch the dashboard to Chinese, keep it after a reload, and switch back to English | ✅ passed | 🟢 passed | Same journey, same result. |
| Move between the main pages from the sidebar menu | ✅ passed | 🟢 passed | Same journey, same result. |

**The rule (code, not a prompt):** every journey that passes on base must pass on the bump → ✅ 2/2 still pass. Merging automatically.

> npm refused this bump's dependency tree (react-i18next@17.0.15 conflicts with i18next@25.10.10). Bumpgate forced the install with --legacy-peer-deps so Kane could show what a forced install ships.

<sub>4 Kane runs · Journeys come from the base branch, so a PR cannot edit its own exam · [Bumpgate](https://github.com/Maheswar-Sah00/bumpgate) · verified with [Kane CLI](https://www.testmuai.com/kane-cli/) by TestMu AI</sub>