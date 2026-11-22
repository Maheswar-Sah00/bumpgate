---
mode: testing
max_steps: 25
---

# Typing broken JSON shows an "invalid json" warning that clears once the JSON is fixed

## Make sure validation is on
In the top-right of the header, find the checkbox labelled "validate json". If it is unchecked, click it so it is checked.

## Type broken JSON into the left editor
Click inside the left editor and type exactly: {"name": "json tool",
The editor may add a closing brace by itself; leave it as it is. Wait until the loading spinner between the editors disappears.
Verify the red bar below the editors shows the text "invalid json".

## Replace it with valid JSON
Click the "Delete all" button above the left editor so both editors are empty.
Click inside the left editor and type exactly: {"name":"json tool"}
Wait until the loading spinner between the editors disappears.

## Check the warning is gone
Verify the text "invalid json" is no longer shown anywhere on the page, and the right editor shows the line "name": "json tool".
