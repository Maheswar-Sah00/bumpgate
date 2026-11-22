---
mode: testing
max_steps: 25
---

# Add a user for a protected server, rejecting an invalid service URL first

## Open the add user dialog
On the home page, click "Settings" in the side navigation.
In the "Manage users" section, click the "Add user" button.

## Enter an invalid service URL
In the "Service URL, e.g. https://ntfy.sh" field, type "not a url".
Verify the error message "Invalid URL format. Must start with http:// or https://" is shown.

## Enter valid details and save
Replace the service URL with "https://ntfy.example.com".
Type "alice" into the "Username, e.g. phil" field and "alice-password" into the "Password" field.
Click the "Add" button.

## Check the users table
Verify the dialog closes and the users table shows a row with "https://ntfy.example.com" and the user "alice".
