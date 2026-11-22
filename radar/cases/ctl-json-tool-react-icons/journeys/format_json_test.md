---
mode: testing
max_steps: 25
---

# Paste raw JSON into the left editor and get it formatted in the right editor

## Check the editor page is ready
Look at the home page. It shows the "JSON tool" header, a left editor with the buttons "Paste from clipboard" and "Delete all", and a right editor with the buttons "Clean spaces", "Clean new lines", "Clean new lines and spaces" and "Copy json".
Verify the "Space tabulation" field next to the right editor shows the value 2.

## Type compact JSON into the left editor
Click inside the left editor and type exactly: {"name":"json tool","version":1}
Wait until the loading spinner between the two editors disappears.

## Check the formatted result
Look at the right editor. The JSON is spread over several lines, with each key on its own line.
Verify the right editor shows the line "name": "json tool", followed by a separate line "version": 1, and that no "invalid json" message is shown below the editors.
