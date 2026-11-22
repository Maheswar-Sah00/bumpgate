---
mode: testing
max_steps: 25
---

# Strip spaces from JSON with "Clean spaces", then clear both editors with "Delete all"

## Type JSON that contains spaces
Click inside the left editor and type exactly: {"city": "New York", "zip": "10001"}
Wait until the loading spinner between the two editors disappears and the right editor shows the formatted JSON.

## Clean the spaces
Click the "Clean spaces" button above the right editor.
Verify the right editor shows the single line {"city":"New York","zip":"10001"}, with the space inside "New York" kept and all other spaces removed.

## Delete everything
Click the "Delete all" button above the left editor.
Verify both editors are empty and the text "New York" no longer appears anywhere on the page.
