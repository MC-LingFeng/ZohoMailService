# Outlook 邮箱接入

在「邮箱账号 → 添加邮箱」中选择「Microsoft Outlook」，填写目标邮箱地址、Microsoft 应用的 Client ID 和 Client Secret，然后跳转微软页面登录并同意授权。应用通过 Microsoft Graph 读取收件箱、垃圾邮件及已发送邮件，查看正文，并从选中的账号发送邮件。

支持个人 Outlook.com、Hotmail 等 Microsoft 邮箱，也支持具有 Exchange Online 邮箱的 Microsoft 365 工作或学校账号。工作或学校账号是否能自行同意授权，取决于所在组织的管理员策略；没有实际 Exchange 邮箱的 Entra 用户不能仅凭登录资料完成绑定。当前使用 Microsoft 全球云端点，不包含世纪互联或美国政府专有云。

## 注册 Microsoft 应用

1. 在 [Microsoft Entra 管理中心](https://entra.microsoft.com/) 的「应用注册」中新建应用。如果同时绑定个人和企业邮箱，受支持的账号类型选择「任何组织目录中的账号和个人 Microsoft 账号」。若仅使用本组织账号，可按组织要求选择对应类型，并设置后文的租户。
2. 添加 **Web** 平台及重定向 URI。URI 必须与应用实际回调完全一致：源码开发通常是 `http://localhost:5173/api/auth/outlook/callback`，本机 EXE 通常是 `http://localhost:3001/api/auth/outlook/callback`，公开服务器使用 `https://你的域名/api/auth/outlook/callback`。
3. 在「API 权限」中添加 Microsoft Graph 的**委托权限**：`User.Read`、`Mail.Read`、`Mail.Send` 和 `offline_access`。这里使用每个邮箱用户自己的登录授权，无需添加读取组织全部邮箱的应用权限。
4. 在「证书和密码」中创建 Client Secret，保存其 **Value（值）**，而非 Secret ID。记下到期时间，过期前更换密钥并重新授权相应邮箱。
5. 复制「应用程序（客户端）ID」，与上一步的 Secret Value 一起填入 ZoHome 的 Outlook 绑定表单。授权时登录表单填写的邮箱。

请使用微软资料返回的邮箱主地址。个人账号的别名、工作账号的其他登录别名不会被当作独立邮箱；绑定时如果报告邮箱不一致，请使用该账号的邮箱主地址重试。

参考：[注册应用](https://learn.microsoft.com/en-us/graph/auth-register-app-v2)、[委托用户授权](https://learn.microsoft.com/en-us/graph/auth-v2-user)、[权限说明](https://learn.microsoft.com/en-us/graph/permissions-reference)。

## 服务配置

默认回调地址使用 `FRONTEND_URL` 加 `/api/auth/outlook/callback`，默认租户为 `common`，允许应用所支持的个人及组织账号登录。需要覆盖时，在应用的 `.env`（桌面版为 `zohome.env`）中设置：

```dotenv
# Microsoft Outlook 授权回调
OUTLOOK_REDIRECT_URI=https://mail.example.com/api/auth/outlook/callback
# common 同时支持个人及组织账号；也可按应用类型使用 consumers、organizations 或租户 ID
OUTLOOK_TENANT=common
```

修改运行配置后重启服务。公开服务器应使用自己的 HTTPS 域名，并将 `/api` 转发到服务端；Microsoft 应用中登记的 Web 重定向 URI 也需要同步。Client ID 和 Client Secret 在邮箱绑定表单填写，不需要另加全局应用密钥配置。一个应用可在受支持的账号类型范围内由多个邮箱分别授权。

Docker 沿用原有应用配置与数据库挂载即可，无需额外的 Outlook JSON 文件。桌面 EXE 使用其本机地址及端口登记 Web 回调，不要误用源码开发的 5173 端口。

## 使用和授权维护

- Zoho 和 Outlook 可在同一个分组及工作区中使用，返利网记录按内部邮箱 ID 关联，旧 Zoho 数据无需转换。
- 「重新授权」默认使用该邮箱已保存的应用配置；更换应用时重新填写 Client ID 和 Client Secret。
- 授权码采用会话绑定的一次性 state 和 PKCE 校验。应用密钥及刷新令牌加密存入本地数据库，浏览器账号接口不返回这些内容。Microsoft 刷新令牌轮换时会保存新令牌。
- 查看真实邮件使用读取权限，不修改服务器的已读状态。发信请求被 Microsoft 接收后返回成功，但不代表最终投递完成；应用不会自动重发失败或超时的发送请求，避免重复邮件。
- 微软要求重新登录、用户撤销授权或组织策略发生变化时，可能需要重新授权。`offline_access` 允许续期，并不保证永久有效。
- Outlook 分页沿用 Microsoft 返回的分页链接；同步或重新连接后从第一页重新读取。邮件内容与数量以实际授权账号的服务器结果为准。

参考：[读取邮件](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)、[发送邮件](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)、[OAuth 授权码和 PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)。

## 常见问题

| 情况 | 检查内容 |
| --- | --- |
| 回调地址不匹配 | 应用平台应为 Web，协议、域名、端口和 `/api/auth/outlook/callback` 路径与运行配置完全一致。 |
| 要求管理员批准 | 让组织管理员审核并同意应用权限，或按组织策略使用已批准的应用。 |
| 登录成功但无法读取邮箱 | 确认账号有 Outlook/Exchange Online 邮箱，且已同意 `Mail.Read`。 |
| 不能发送邮件 | 确认已同意 `Mail.Send`，并检查邮箱发信限制。不要反复点击发送重试。 |
| 应用密钥失效 | 检查使用的是 Secret Value、密钥尚未到期；更新应用配置后重新授权。 |
| 邮箱地址不一致 | 使用微软资料返回的邮箱主地址，或在微软登录页切换到正确账号。 |

代码测试使用模拟 Microsoft 响应验证绑定、令牌续期和邮件流程。首次接入仍需使用自己的 Microsoft 应用和邮箱完成一次实际授权与收发验证。
