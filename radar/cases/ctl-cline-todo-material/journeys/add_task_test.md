---
mode: testing
max_steps: 25
---

# Add a new task, rejecting a blank title, and keep it after a reload

## Try to add a task without a title
In the "New Task" form, leave the "Title" field empty and click the "Add Task" button.
Verify no task is added and the text "No tasks yet. Add one above!" is still shown.

## Add a task with a title and description
Type "Buy groceries" into the "Title" field and "Milk, eggs and bread" into the "Description" field, then click the "Add Task" button.
Verify the task list shows "Buy groceries" with the description "Milk, eggs and bread", and the text "1 of 1 task active" is shown.

## Reload the page
Reload the page.
Verify the task "Buy groceries" is still shown in the list with the text "1 of 1 task active".
