---
mode: testing
max_steps: 25
---

# Home page shows the login form and links to sign-up and back

## Open the app
Open the home page. The app should send you to its login screen.
Verify the heading "Szakal 2" and the text "Zaloguj się by kontynuować" are visible.

## Fill in the login form without submitting
Type "jan.kowalski@example.com" into the "Email" field and "Haslo12345" into the "Password" field. Do not press "Zaloguj".
Verify the "Email" field shows "jan.kowalski@example.com" and a "Zaloguj" button is visible.

## Go to the sign-up form
Next to the text "Nie masz konta?", click the link "Zarejestruj się".
Verify the sign-up form shows the fields "E-mail", "Imię", "Nazwisko", "Hasło" and "Powtórz Hasło".

## Return to the login form
Next to the text "Masz juz konto?", click the link "Zaloguj się".
Verify the text "Zaloguj się by kontynuować" is visible again.
