---
mode: testing
max_steps: 25
---

# The feedback form refuses an empty message and counts what the player types

## Open the feedback form
On the title screen, click the "Send Feedback" button.
Verify a dialog titled "Send Feedback" opens with the question "How are you enjoying it?" and the counter "0/2000".

## Try to send an empty message
Type only three spaces into the "Tell us more" box.
Verify the "Send" button stays disabled and cannot be clicked.

## Fill in the form without sending
Clear the "Tell us more" box, click the "Idea" category and type exactly "The bag icon is hard to see" into it.
Verify the counter reads "27/2000" and the "Send" button is now enabled. Do not click "Send".

## Close the form
Click the close button (the "X") in the top-right corner of the dialog.
Verify the dialog is gone and the title screen's "Send Feedback" button and tagline "Carve the land. Raise a settlement. Close the rifts." are visible again.
