<!-- bumpgate:v1 -->
### 🔴 Bumpgate · Blocked: the app broke on this bump

**`react 18.3.1 → 19.3.1`**  ·  CI checks that the code builds. **Kane CLI checked that the app still works**: 3 journeys replayed in a real browser on base `b01ed37` and on this bump `0a90cdf`.

| Journey | Base | This bump | Kane says |
|---|---|---|---|
| Login page loads and checks each required field in order | ✅ passed | 🔴 broke at step 1 · 2/2 runs | **Open the login page**: Login page fails to render after home navigation (major) · new error on this bump: `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')` |
| Sign-up dialog catches mismatched passwords and closes cleanly | ✅ passed | 🔴 broke at step 1 · 2/2 runs | **Open the sign-up dialog**: Login page crashes before rendering registration controls (major) · new error on this bump: `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')` |
| Sign-up dialog opens and blocks an empty or too-short account | ✅ passed | 🔴 broke at step 1 · 2/2 runs | **Open the sign-up dialog**: Login page fails to render after React exception (critical) · new error on this bump: `Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')` |

**The rule (code, not a prompt):** every journey that passes on base must pass on the bump → ❌ 3 broke. Merge blocked.

<details><summary><b>Evidence</b>: what Kane saw, console, network</summary>

**Login page loads and checks each required field in order**

Kane (confirmed bug): _The site reached the requested URL but did not render the login page or any of its required controls._

Kane's diagnosis: A page error occurred while the site was loading, leaving the screen blank instead of showing the login page. Fix the startup error that references ReactCurrentBatchConfig, then retest that the home URL displays the login heading, all three fields, and both buttons.

New console errors on the bump:
```
Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')
```

**Sign-up dialog catches mismatched passwords and closes cleanly**

Kane (confirmed bug): _The login page stays blank because it crashes while loading, so the 注册 button and 注册账号 dialog cannot be reached._

Kane's diagnosis: The page encountered an error during startup and did not display its login content. Fix the startup error causing the blank login page, then verify that 登录 and 注册 appear and that 注册 opens the 注册账号 dialog.

New console errors on the bump:
```
Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')
```

**Sign-up dialog opens and blocks an empty or too-short account**

Kane (confirmed bug): _The login page did not load, so the registration button and dialog could not be checked._

Kane's diagnosis: The page encountered a JavaScript error while loading and rendered as a blank screen instead of showing the login controls. Fix the page-load JavaScript error, then rerun the registration-dialog check.

New console errors on the bump:
```
Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')
```


</details>

<sub>9 Kane runs · Journeys come from the base branch, so a PR cannot edit its own exam · [Bumpgate](https://github.com/Maheswar-Sah00/bumpgate) · verified with [Kane CLI](https://www.testmuai.com/kane-cli/) by TestMu AI</sub>