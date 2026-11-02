# ZoHome Service

NestJS 11 + TypeScript + Node.js 22.13+ 内置 SQLite。默认以本地演示模式运行。

```bash
cp .env.example .env
npm install
npm run start:dev
```

默认服务地址为 `http://127.0.0.1:3001/api`；前端 Vite 将 `/api` 代理到此服务。生产构建运行 `npm run build && npm start`。根目录工作区也提供统一启动和构建命令。

## 模式与配置

- `APP_MODE=demo`：6 个示例邮箱及演示邮件；读取、编辑账号和演示发送存入 `data/demo.sqlite`。不访问 Zoho，不会发出真实邮件。
- `APP_MODE=live`：使用 `data/live.sqlite`。需要 `APP_PASSWORD`（至少 12 个字符）和 `TOKEN_ENCRYPTION_KEY`（64 个十六进制字符）。管理界面登录后才可读取账号、邮件或执行操作。
- 绑定真实邮箱时，在「添加邮箱」表单中手动填写邮箱地址、Client ID、Client Secret；完成 Zoho 官方授权后，客户端配置与该邮箱关联保存到数据库。不同邮箱可以使用相同或不同的 OAuth 应用。新绑定不再依赖环境中的 `ZOHO_CLIENT_ID`、`ZOHO_CLIENT_SECRET`。在 [Zoho API Console](https://api-console.zoho.com/) 注册 Server-based Application，回调地址必须与 `ZOHO_REDIRECT_URI` 完全一致。默认 `http://localhost:5173/api/auth/zoho/callback`，开发时由 Vite 代理。
- `FRONTEND_URL` 默认 `http://localhost:5173`，用于来源校验与授权完成后的跳转。前端请使用相同主机名，不要混用 `localhost` 和 `127.0.0.1`。
- `DATA_DIR` 默认 `./data`。每个邮箱单独保存 Client ID、加密的 Client Secret 和加密的刷新令牌（AES-256-GCM）。账号列表和详情接口不会返回这些凭据。保护数据库和加密密钥的备份，保持密钥不变。Session 与 OAuth state 仅存在内存，重启需重新登录；已绑定邮箱的授权持久保存。
- 绑定请求的客户端密钥先加密存入 SQLite 临时表，与会话绑定的一次性 state 哈希关联，10 分钟过期。回调核对实际授权的主邮箱必须与填写地址匹配；不匹配时不保存账号关联。回调消费临时记录，过期记录在新请求及回调时清理。
- 旧账号没有单独客户端字段时，仍可使用旧环境中的 `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` 刷新授权，首次成功刷新后自动将客户端配置加密迁入该账号记录。不要在迁移完成前删除旧全局凭据。单独客户端配置不完整或解密失败时，不会静默回退旧环境。
- 当前仅支持美国数据中心 `accounts.zoho.com` / `mail.zoho.com`，不会信任回调中外部传入的 `accounts-server` 地址。
- 默认绑定回环地址 `127.0.0.1`。公网部署需 HTTPS、持久存储、反向代理及相应 Cookie/回调域配置。

生成加密密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## 接口

所有接口位于 `/api`；真实模式中，除 `/status`、登录和 OAuth 回调外，均要求管理会话。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/status` | 当前模式、OAuth 配置、登录状态 |
| POST / DELETE | `/session` | 管理登录 `{password}` / 退出 |
| GET | `/accounts` | 不含令牌的账号列表 |
| PATCH / DELETE | `/accounts/:id` | 编辑 `{name?,group?}` / 从本系统断开账号 |
| GET | `/accounts/:id/folders` | 当前账号的文件夹列表，Zoho 包含通知、订阅及自定义文件夹 |
| GET | `/accounts/:id/messages` | `folder=inbox\|spam\|sent\|other&folderId=...&start=1&limit=30`；`other` 必须指定文件夹 ID |
| GET | `/accounts/:id/messages/:messageId?folderId=...` | 获取已列出的邮件正文 |
| POST | `/accounts/:id/send` | 发送 `{to,subject,content}`，当前为单收件人纯文本 |
| POST | `/accounts/:id/sync?folder=...&folderId=...` | 刷新所选文件夹并使该账号缓存失效；省略参数默认收件箱 |
| POST | `/auth/zoho/url` | 提交 `{email,clientId,clientSecret}`，保存待绑定配置并生成授权地址 |
| POST | `/accounts/:id/reauthorize` | 使用此邮箱已保存的客户端配置生成重新授权地址 |
| GET | `/auth/zoho/callback` | 一次性 state 校验、连接邮箱并跳回前端 |
| GET | `/overview` / `/activity` | 已连接账号、本地已缓存未读、今日发送及近期活动 |

真实模式列表缓存 60 秒，文件夹映射缓存 1 小时；`q` 为当前页文本过滤，演示模式为当前文件夹过滤。正文按需读取，真实模式读取不更改 Zoho 已读标记（只申请 READ/CREATE 权限）。未读数是当前缓存中观察到的收件箱未读数，不代表未抓取的全部邮件。今日发送统计仅包含经本系统发送的邮件，按 Asia/Shanghai 日期计算。附件仅显示存在标识，当前不提供附件上传或下载。

Zoho 文件夹入口按接口返回的真实列表动态展示，包括 Notification、Newsletters 和自定义收信文件夹。系统文件夹优先按路径识别，不把自定义文件夹的 `folderType=Inbox` 当成系统收件箱；文件夹 ID 必须属于当前账号。选择文件夹时按需读取邮件，归档筛选仅用于独立的 Archive 文件夹，避免隐藏普通收件箱和通知邮件；刷新当前标签会重新获取文件夹列表。Outlook 继续提供收件箱、垃圾邮件及已发送入口。

断开操作只删除本地连接和缓存，不删除 Zoho 邮箱或邮件。需要撤销 Zoho 端授权时，到 Zoho Accounts 的 Connected Apps 中移除此应用。

## 规模与限流

不对 2000 个账号自动全量轮询。按需加载当前账号，统一串行队列默认至少间隔 2100ms（不足 30 次 Mail API 请求/分钟），相同列表的并发请求合并；遇到限流暂停新请求一分钟并提示用户，发送超时不自动重试，避免重复发信。`ZOHO_MIN_REQUEST_INTERVAL_MS` 只允许提高该间隔。

真正部署 2000 个独立免费邮箱前，仍须用实际账号验证免费权限、应用账号规模、令牌及接口限流维度。该版本不承诺 2000 账号实时同步；首次连接仍需逐账号 OAuth 授权。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

测试只使用临时 SQLite、演示数据或模拟 Zoho 响应，不发送真实邮件。覆盖多邮箱独立客户端、密钥加密及接口脱敏、回调邮箱核对、绑定请求过期及重放保护、旧请求与新凭据的竞争保护、管理登录、来源校验、发送重试策略、请求校验和演示邮件操作。
