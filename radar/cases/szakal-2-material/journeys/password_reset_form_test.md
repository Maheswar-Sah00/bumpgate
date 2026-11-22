---
mode: testing
max_steps: 25
---

# Forgotten-password link opens the password reset form

## Open the password reset form
On the login screen, next to the text "Nie pamiętasz hasła?", click the link "Zresetuj je".
Verify the title "Resetuj hasło" is visible.

## Enter an email address without sending it
Type "jan.kowalski@example.com" into the "Email" field. Do not click "Reset".
Verify the field shows "jan.kowalski@example.com" and the "Reset" button is visible and enabled.
