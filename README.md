# ZoHome

多个 Zoho 邮箱，一个工作空间。ZoHome 提供系统介绍首页、邮件工作台、邮箱账号和使用指南，支持在同一个界面切换邮箱，查看收件箱与垃圾邮件，并选择账号发送邮件。

前端位于 `ZohoWeb`，使用 React、Vite、TypeScript 和 Tailwind CSS；后端位于 `ZohoService`，使用 NestJS、TypeScript 和 SQLite。界面样式由统一的 Tailwind 主题和全局公共类管理。

邮件工作台左侧提供两级账号树：一级为分组，二级为邮箱。搜索支持按分组、账号名称和邮箱地址模糊匹配；命中分组时显示整组邮箱，命中账号名称或地址时显示对应邮箱及其分组。点击邮箱后按需加载它的邮件，展开分组或搜索不会请求所有账号的邮件。

## Windows EXE 启动

Windows x64 用户可以双击 `ZoHome-win-x64.exe` 启动，无需安装 Node.js 或 npm。程序在同一个进程中提供网页和 API，自动打开 <http://localhost:3001>，并保留一个控制台窗口。按 **Ctrl+C** 或关闭该控制台窗口即可停止整个应用；只关闭浏览器标签页不会停止服务。

首次运行会在 `%LOCALAPPDATA%\ZoHome` 创建工作区和 `zohome.env`，默认使用演示模式，并自动生成工作区密码和令牌加密密钥。真实模式、密码和 OAuth 回调均在这个配置文件中管理；EXE 中不包含开发机的环境变量、邮箱配置或数据库。

要接入真实邮箱，先关闭程序，在 `zohome.env` 中把 `APP_MODE` 改为 `live`，再重新运行。登录密码使用文件中的 `APP_PASSWORD`，邮箱应用凭据仍在「邮箱账号」页面填写。**EXE 的 Zoho 授权回调是 `http://localhost:3001/api/auth/zoho/callback`，与开发环境的 5173 端口不同。**

在源码仓库构建 Windows EXE：

```sh
nvm use
npm install
npm run package:win
```

产物位于 `release/ZoHome-win-x64.exe`。构建要求使用 `.nvmrc` 指定的 **Node.js 22.22.2**；使用该 EXE 的用户不需要安装任何开发工具。打包脚本可在 macOS 上交叉构建 Windows x64 产物，但 macOS 无法执行 Windows EXE，仍需在 Windows 上确认实际运行情况。详细步骤见 [Windows EXE 使用与构建](docs/windows-exe.md)。

## Docker 启动

Docker 方式将网页和 API 放在一个容器中，默认通过 <http://localhost:3001> 访问。宿主机需要 Docker 与 Docker Compose v2，无需安装 Node.js 或 npm。

配置文件和数据库使用宿主机挂载：`ZohoService/.env` 只读挂载，`ZohoService/data` 读写挂载；两者不会打入镜像。**已有 `.env` 时直接使用，勿用示例文件覆盖。** 首次创建时可参考 `docker.env.example`：

```sh
test -f ZohoService/.env || cp docker.env.example ZohoService/.env
mkdir -p ZohoService/data
```

示例默认启用真实模式，首次使用时须先替换 `APP_PASSWORD` 和 `TOKEN_ENCRYPTION_KEY` 的占位值。已有配置保留原密码和密钥。使用默认端口时，配置 `FRONTEND_URL=http://localhost:3001`、`ZOHO_REDIRECT_URI=http://localhost:3001/api/auth/zoho/callback`，并在 Zoho 应用中登记同一回调。也可以通过 `ZOHOME_PORT=5173` 保留已有的 5173 地址和回调。复用真实账号数据库时，应保留原有 `TOKEN_ENCRYPTION_KEY`。

项目根目录的 `.env` 用于保存 Compose 参数，与应用的 `ZohoService/.env` 分开。本次本机部署已保存 `ZOHOME_PORT=5173` 及本机文件权限参数，直接访问 <http://localhost:5173>。独立配置、数据路径及镜像源设置见下方部署文档。

```sh
docker compose up -d --build
```

停止使用 `docker compose down`，宿主机的配置与数据库会保留。详细的独立配置、数据路径、Linux 权限及部署说明见 [Docker 使用与持久化](docs/docker.md)。

## 本地启动

需要 Node.js **22.13 或以上版本**，建议使用 `.nvmrc` 指定的 22.22.2。默认 Node 16 无法运行当前工具链。已安装 nvm 时，在项目根目录运行：

```sh
nvm use
npm install
npm run dev
```

打开 <http://localhost:5173>。Vite 将 `/api` 请求转发到本机 NestJS 服务 `http://127.0.0.1:3001`，开发时无需额外配置跨域。

默认启动演示模式，可以直接查看示例账号、邮件和使用流程。演示发送只写入本地演示数据，不会向外部发送邮件；页面会明确显示演示状态。真实模式需要完成下文的 Zoho OAuth 配置。

页面右上角可以切换 **Light（白天）**、**Dark（黑夜）** 和 **Auto（跟随系统）**。默认 Auto；手动选择会保存在当前浏览器，刷新后继续生效。Auto 会实时跟随系统外观，登录页和服务未连接页面也支持切换。

常用命令均在根目录执行：

| 命令                  | 用途                                   |
| --------------------- | -------------------------------------- |
| `npm run dev`         | 同时启动前后端                         |
| `npm run dev:web`     | 只启动前端                             |
| `npm run dev:service` | 只启动后端                             |
| `npm run build`       | 构建前后端                             |
| `npm test`            | 检查前端类型并运行服务端测试           |
| `npm run package:win` | 构建包含网页和服务端的 Windows x64 EXE |

## 接入真实邮箱

源码开发模式首次启用真实模式时，在 `ZohoService/.env` 中设置。使用 Windows EXE 时，请修改工作区中的 `zohome.env`，并保留 3001 端口的页面与回调地址。以下为开发模式示例：

```dotenv
APP_MODE=live
APP_PASSWORD=请设置至少12个字符的工作区密码
TOKEN_ENCRYPTION_KEY=请替换为64个十六进制字符的随机密钥
FRONTEND_URL=http://localhost:5173
ZOHO_REDIRECT_URI=http://localhost:5173/api/auth/zoho/callback
```

可以用以下命令生成加密密钥，然后仅将结果保存到服务端 `.env`：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

这些值属于工作区和服务端配置。**新绑定的 Zoho Client ID 和 Client Secret 在页面上按邮箱填写，不需要设置全局应用凭据。**

1. 在 [Zoho API Console](https://api-console.zoho.com/) 创建 **Server-based Application**，取得 Client ID 和 Client Secret。将授权回调登记为 `http://localhost:5173/api/auth/zoho/callback`，与服务端配置完全一致。
2. 重启服务，用工作区密码进入 ZoHome。在「邮箱账号」点击「添加邮箱」，手动填写目标邮箱地址、Client ID 和 Client Secret。
3. 表单通过 `POST /api/auth/zoho/url` 提交。服务端将待授权配置保存到数据库，其中 Client Secret 加密保存；记录有效期为 10 分钟，并返回 Zoho 官方授权地址。
4. 在 Zoho 官方页面登录并授权。**登录邮箱必须与表单中填写的地址匹配**；若当前浏览器登录了其他账号，ZoHome 会拒绝绑定并给出提示。
5. 授权成功后，应用配置和授权令牌与邮箱关联保存。以后切换邮箱会复用有效授权；需要重新授权时，直接使用对应账号的入口，无需重新填写应用凭据。

ZoHome 不收集邮箱登录密码，邮箱登录及同意授权始终在 Zoho 官方页面完成。

如需替换某个邮箱的 Client ID 或 Client Secret，在该账号中选择「更换应用配置」，重新填写并完成授权。旧账号与旧配置会保留到新授权成功且邮箱匹配后，再更新为新配置。

主要环境变量：

| 变量                                    | 说明                                                |
| --------------------------------------- | --------------------------------------------------- |
| `APP_MODE`                              | 默认 `demo`；真实邮箱使用 `live`                    |
| `APP_PASSWORD`                          | 真实模式的工作区登录密码，至少 12 个字符            |
| `TOKEN_ENCRYPTION_KEY`                  | 真实模式必填，64 个十六进制字符，须保持稳定         |
| `ZOHO_REDIRECT_URI`                     | 默认 `http://localhost:5173/api/auth/zoho/callback` |
| `FRONTEND_URL`                          | 默认 `http://localhost:5173`                        |
| `HOST` / `PORT`                         | 默认 `127.0.0.1` / `3001`                           |
| `DATA_DIR`                              | 默认 `./data`，演示与真实模式使用各自的数据库       |
| `ZOHO_MIN_REQUEST_INTERVAL_MS`          | 默认 `2100`，保守控制对 Zoho 的请求间隔             |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | 可选，仅兼容旧记录；新绑定使用表单提交的邮箱级配置  |

每个账号在数据库中关联邮箱地址、Client ID、加密的 Client Secret 和加密的 Refresh Token。待授权表单中的凭据仅用于当前绑定流程，不回传给页面，也不保存到浏览器持久化存储。不要把 Client Secret、令牌加密密钥或 Refresh Token 写入前端环境变量、日志或版本库。

演示和真实模式的数据分别保存在 `ZohoService/data/demo.sqlite` 与 `ZohoService/data/live.sqlite`。`.env` 与 SQLite 运行数据已加入忽略列表。更换加密密钥后，旧密钥加密的授权和应用凭据无法解密；请将数据库与对应密钥分别安全备份。

当前目标是国际站 `mail.zoho.com`。免费账号的实际 API 权限应以真实账号测试结果为准，首轮建议先接入 3–5 个账号，验证收件箱、垃圾邮件、发信与授权续期，再扩大接入范围。

## 规模与运行边界

2000 个账号是系统设计目标，尚未完成 2000 个真实邮箱的接入与持续同步验证。工作台按当前选中的账号加载邮件，避免打开页面时同时向全部邮箱请求。后台请求应复用有效令牌、缓存结果并限制并发；发送邮件仍受各账号的 Zoho 原有额度约束。

Zoho 官方公布 API 限额为 30 次请求/分钟，但没有明确说明按账号、应用还是 IP 统计；其 API 入门文档也说明各接口限额可能不同。正式扩大规模前，需要确认适用额度与限制维度。详情见 [官方限额](https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html) 与 [API 入门](https://www.zoho.com/mail/help/api/getting-started-with-api.html)。

默认服务只监听本机。需要向其他设备开放或部署到服务器时，应配置 HTTPS、反向代理和访问控制，并验证 Cookie、OAuth 回调、环境变量及备份策略。

目录说明及调用流程见 [架构说明](docs/architecture.md)。
