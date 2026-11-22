---
mode: testing
max_steps: 25
---

# Login page loads and checks each required field in order

## Open the login page
The home page sends you to the login page.
Verify the heading "风控引擎管理平台" is visible, with the fields "用户名", "密码" and "验证码" and the buttons "登录" and "注册".

## Submit an empty form
Leave every field empty and click the "登录" button.
Verify an error message with the text "请输入用户名" is shown.

## Submit with only a username
Type "admin" into the "用户名" field and click the "登录" button.
Verify the error message now reads "请输入密码".

## Submit without a captcha
Type "123456" into the "密码" field, leave "验证码" empty, and click the "登录" button.
Verify the error message now reads "请输入验证码".
