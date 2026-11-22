---
mode: testing
max_steps: 25
---

# A new skill cannot be saved without a description or with an invalid name

## Open the Skills page
In the sidebar menu, click "Skills".
Verify the text "Analysis playbooks you've written for the agent" and a "New" button are visible.

## Start a new skill
Click the "New" button.
Verify the "Name" field and the "Description (one line - what the agent sees)" field appear.

## Try to save with an empty description
Leave the description empty and click "Save".
Verify the error message "Description is required" is visible.

## Try to save with an invalid name
Type "My Skill" in the "Name" field and "Detect overtraining from HRV trend" in the description field, then click "Save".
Verify the error message "Name must match a-z, 0-9, _ or - (no spaces, no uppercase)" is visible.
