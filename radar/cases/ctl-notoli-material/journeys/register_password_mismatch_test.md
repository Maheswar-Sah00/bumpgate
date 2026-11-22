---
mode: testing
max_steps: 25
---

# Sign-up form blocks registration when the two passwords do not match

## Go to the sign-up form
From the sign-in screen shown on the home page, click the "Create Account!" link.
Verify the sign-up form shows the fields "Email", "Username (optional)", "Password" and "Confirm Password" and a "Register" button.

## Fill in the form with mismatched passwords
Type "jane.doe@example.com" into the "Email" field.
Type "janedoe" into the "Username (optional)" field.
Type "Example-Pass-123" into the "Password" field.
Type "Different-Pass-456" into the "Confirm Password" field.

## Submit the form
Click the "Register" button.
Verify an error message with the text "Passwords do not match." appears, and the sign-up form with the "Register" button is still shown.
