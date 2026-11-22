---
mode: testing
max_steps: 25
---

# Sign-up dialog catches mismatched passwords and closes cleanly

## Open the sign-up dialog
On the login page, click the "注册" button.
Verify a dialog titled "注册账号" is shown.

## Type passwords that do not match
Type "radaruser" into the "账号" field, "Radar123" into the "密码" field and "Radar456" into the "确认密码" field.
Verify the message "两次输入不一致！" appears under the "确认密码" field.

## Make the passwords match
Clear the "确认密码" field and type "Radar123".
Verify the message "两次输入不一致！" is no longer shown.

## Cancel the dialog
Click the "取消" button.
Verify the dialog titled "注册账号" is closed and the login page shows the "登录" button and the text "Radar is open source licence".
