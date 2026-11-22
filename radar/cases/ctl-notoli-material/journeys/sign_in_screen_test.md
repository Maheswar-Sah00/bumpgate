---
mode: testing
max_steps: 25
---

# A signed-out visitor is sent to the sign-in form and can fill it in

## Open the app while signed out
Open the home page without being signed in.
Verify the app shows the sign-in screen with the large "notoli" title, an "Email" field, a "Password" field and a "Login" button.

## Fill in the sign-in form
Type "jane.doe@example.com" into the "Email" field.
Type "Example-Pass-123" into the "Password" field.
Verify the "Email" field shows the text "jane.doe@example.com".

## Check the account links are offered
Look below the "Login" button.
Verify the links "Forgot Password?" and "Create Account!" are visible.
