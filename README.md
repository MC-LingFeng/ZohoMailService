# ZoHome

多个邮箱，一个工作空间。ZoHome 提供系统介绍首页、邮件工作台、邮箱账号和使用指南，支持在同一个界面切换 Zoho 与 Microsoft Outlook 邮箱，查看收件箱与垃圾邮件，并选择账号发送邮件。

绑定邮箱时可选择 Zoho 或 Outlook。Outlook 使用 Microsoft Graph 和微软网页登录授权，支持个人 Outlook/Hotmail 邮箱及具有 Exchange Online 邮箱的 Microsoft 365 账号，应用凭据与离线令牌按邮箱加密保存。配置 Microsoft 应用及回调地址后即可连接，详见 [Outlook 接入说明](docs/outlook.md)。已有 Zoho 账号及其返利网数据继续使用。

前端位于 `ZohoWeb`，使用 React、Vite、TypeScript 和 Tailwind CSS；后端位于 `ZohoService`，使用 NestJS、TypeScript 和 SQLite。界面样式由统一的 Tailwind 主题和全局公共类管理。

邮件工作台左侧提供两级账号树：一级为分组，二级为邮箱。搜索支持按分组、账号名称和邮箱地址模糊匹配；命中分组时显示整组邮箱，命中账号名称或地址时显示对应邮箱及其分组。点击邮箱后按需加载它的邮件，展开分组或搜索不会请求所有账号的邮件。

Zoho 的邮件标签根据账号实际文件夹动态显示，通知（Notification）、订阅（Newsletters）及自定义收信文件夹均可切换查看；标签较多时左右滚动。刷新按钮刷新当前所选文件夹并更新文件夹列表，列表加载失败时可重试，不会把通知邮件当作垃圾邮件。Outlook 继续提供收件箱、垃圾邮件和已发送入口。

「返利网」页面位于 `/rebates`，按邮箱保存返利网名称、域名、创建日期、offer、总收益、总成本、结款状态和周期、封户状态及 IP，支持新增、编辑、删除、搜索和分页。顶部使用 ECharts 按 Offer 名称合并对比收益、成本和转化：同名 Offer 跨邮箱、返利网及域名汇总，转化使用合计收益与合计成本重新计算，不平均各记录的转化；支持按收益、成本或转化倍数排序，拖动滑块浏览全部项目，悬浮查看完整金额，并可展开 Offer 汇总明细。筛选同步影响图表和统计，汇总包含全部匹配记录，不只当前页；下方注册明细仍逐条显示。Offer 名称去掉首尾空格后匹配，区分大小写，未填写名称的记录汇总为一项。转化以约分后的 `总成本:总收益` 展示，例如 `20:400 → 1:20`，汇总转化使用汇总金额约分。小数金额先换算成分再约分；成本、收益都为零时显示 `0:0`，仅成本为零显示 `0:1`，仅收益为零显示 `1:0`。新增和编辑时可搜索并选择全部已保存记录中的返利网名称、域名和 Offer，也可手动输入新值；保存后下次可复用。金额保留两位小数，录入时须使用同一币种。数据保存在当前模式的本地 SQLite 数据库中；移除邮箱会同步移除其返利网记录。

新增返利网时也可直接输入尚未绑定的邮箱地址，保存后标为「未知」。此类地址只存在于返利网记录及其筛选、统计和成本分摊中，不会加入「邮箱账号」、邮件工作台或首页邮箱统计，也不需要先完成邮箱授权。同一地址忽略首尾空格和大小写后复用；之后绑定同名邮箱不会自动改动既有记录，需要在编辑记录时明确选择已绑定邮箱。删除已绑定邮箱仍会清理其关联记录，独立的「未知」记录不受影响。

总览中已封户记录只计成本、不计收益，明细保留原始录入金额。收益图将未收款部分显示为浅红色，已收款部分显示为绿色，同一对比项的两种状态分段展示，并与成本柱并排显示。转化折线使用右侧独立坐标轴展示“收益 ÷ 成本”的倍数，成本为零时不绘制倍数点；原始成本与收益比例仍在悬浮提示和对比明细中保留。转化对比补充归一化到一份成本的近似值，保留三位小数，例如 `4:41 ≈ 1:10.250`；表格显示 `4:41 ≈ 10.250`。成本为零时近似值显示 `—`。

「新增记录」旁的「刷新预算」可手动读取 Google Ads 经理号下全部广告账户的累计消费，按广告系列名称精确匹配 Offer，覆盖保存美元成本。同名系列先汇总，再按关联邮箱均分；同邮箱同 Offer 有多条记录时继续均分，合计保持一致。刷新包含全部记录，不受当前筛选和分页限制；未匹配及非 USD 数据保留原成本并提示。配置服务账号 JSON、经理号和 Google Cloud 项目 API 访问权限后即可使用，详见 [Google Ads 成本刷新](docs/google-ads.md)。Docker 使用文档中的可选密钥挂载配置，密钥不进入镜像。

「系统设置」页面位于 `/settings`，自动读取应用当前使用的 `.env`（桌面版为 `zohome.env`），以配置项对应的注释作为字段标题。保存时保留注释、顺序和其他配置，修改后重启应用生效。密码和密钥只显示是否已配置，留空会保留原值；已有邮箱授权使用的加密密钥应保持不变。项目根目录的 `.env` 属于 Docker Compose 参数，仍在文件中维护。

## Windows EXE 启动

Windows x64 用户可以双击 `ZoHome-win-x64.exe` 启动，无需安装 Node.js 或 npm。程序在同一个进程中提供网页和 API，自动打开 <http://localhost:3001>，并保留一个控制台窗口。按 **Ctrl+C** 或关闭该控制台窗口即可停止整个应用；只关闭浏览器标签页不会停止服务。

首次运行会在 `%LOCALAPPDATA%\ZoHome` 创建工作区和 `zohome.env`，默认使用演示模式，并自动生成工作区密码和令牌加密密钥。真实模式、密码和 OAuth 回调均在这个配置文件中管理；EXE 中不包含开发机的环境变量、邮箱配置或数据库。

要接入真实邮箱，可在「系统设置」中将运行模式改为真实邮箱并保存，然后关闭程序、重新运行；也可关闭程序后，在 `zohome.env` 中把 `APP_MODE` 改为 `live`。登录密码使用文件中的 `APP_PASSWORD`，邮箱应用凭据仍在「邮箱账号」页面填写。**EXE 的 Zoho 授权回调是 `http://localhost:3001/api/auth/zoho/callback`，与开发环境的 5173 端口不同。**

在源码仓库构建 Windows EXE：

```sh
nvm use
npm install
npm run package:win
```

产物位于 `release/ZoHome-win-x64.exe`。构建要求使用 `.nvmrc` 指定的 **Node.js 22.22.2**；使用该 EXE 的用户不需要安装任何开发工具。打包脚本可在 macOS 上交叉构建 Windows x64 产物，但 macOS 无法执行 Windows EXE，仍需在 Windows 上确认实际运行情况。详细步骤见 [Windows EXE 使用与构建](docs/windows-exe.md)。

## Docker 启动

Docker 方式将网页和 API 放在一个容器中，默认通过 <http://localhost:3001> 访问。宿主机需要 Docker 与 Docker Compose v2，无需安装 Node.js 或 npm。

配置文件和数据库使用宿主机挂载：`ZohoService/.env` 与 `ZohoService/data` 均可读写，以便在「系统设置」中保存应用配置；两者不会打入镜像。**已有 `.env` 时直接使用，勿用示例文件覆盖。** 首次创建时可参考 `docker.env.example`：

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
| `npm test`            | 检查前端类型、金额比例和服务端功能     |
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
