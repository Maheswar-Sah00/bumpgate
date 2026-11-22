---
mode: testing
max_steps: 25
---

# Sign-up form warns when passwords do not match and clears the warning once they do

## Open the sign-up form
On the login screen, next to the text "Nie masz konta?", click the link "Zarejestruj się".
Verify the subtitle "Zarejestruj się" and the field "Powtórz Hasło" are visible.

## Fill in the personal details
Type "jan.kowalski@example.com" into "E-mail", "Jan" into "Imię" and "Kowalski" into "Nazwisko".

## Enter two different passwords
Type "Szakal2Haslo2026" into "Hasło". Type "Szakal2Haslo2025" into "Powtórz Hasło".
Verify the error text "Hasła nie zgadzają się" is visible and the "Zarejestruj się" submit button is disabled.

## Fix the repeated password
Clear the "Powtórz Hasło" field and type "Szakal2Haslo2026" into it. Do not submit the form.
Verify the text "Hasła nie zgadzają się" is no longer shown, the "Zarejestruj się" submit button is enabled, and the password strength label reads "Bardzo silne".
