---
mode: testing
max_steps: 25
---

# Delete a task by mistake and restore it with Undo

## Add a task
Type "Call the dentist" into the "Title" field and click the "Add Task" button.
Verify the task "Call the dentist" appears in the list.

## Delete the task
Click the "Delete task" button for "Call the dentist".
Verify the message "Deleted "Call the dentist"" is shown and the text "No tasks yet. Add one above!" appears.

## Undo the delete
Click the "Undo" button in the message.
Verify the task "Call the dentist" is shown in the list again with the text "1 of 1 task active".
