---
mode: testing
max_steps: 25
---

# Sign-up dialog opens and blocks an empty or too-short account

## Open the sign-up dialog
On the login page, click the "注册" button.
Verify a dialog titled "注册账号" opens with the fields "账号", "密码", "确认密码", "码云昵称" and "验证码", and the buttons "确认" and "取消".

## Confirm with nothing filled in
Click the "确认" button without typing anything.
Verify the dialog stays open and shows the messages "请输入账号", "请输入确认密码" and "请输入正确的码云昵称".

## Enter an account name that is too short
Type "ab" into the "账号" field.
Verify the message "长度不在范围内" appears under the "账号" field.

## Fix the account name
Clear the "账号" field and type "radaruser" instead.
Verify the message "长度不在范围内" is no longer shown and the dialog titled "注册账号" is still open.
