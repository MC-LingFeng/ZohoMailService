# Windows EXE 使用与构建

ZoHome 的 Windows 分发文件是 `ZoHome-win-x64.exe`，适用于 Windows x64。它将 Node.js 运行时、NestJS 服务端和构建后的 React 页面合并为一个可执行文件。用户无需另行安装 Node.js、npm，或启动 Vite 开发服务器。

## 启动和停止

1. 将 `ZoHome-win-x64.exe` 放到本机方便访问、允许写入的目录。
2. 双击运行。程序会打开一个控制台窗口，并自动在默认浏览器中打开 <http://localhost:3001>。
3. 如果浏览器没有自动打开，手动访问上面的地址。
4. 使用结束后，在控制台按 **Ctrl+C**，或者直接关闭该控制台窗口。网页和 API 属于同一个应用进程，会一起停止。

控制台窗口在使用期间需要保持打开。仅关闭浏览器标签页不会停止服务，再次打开 <http://localhost:3001> 可以继续访问。

默认启动演示模式，所有示例邮件与模拟发件都保存在本地，不会向真实收件人投递。

## 配置与数据

打包后的 EXE 默认使用自身所在目录作为工作区，不受启动终端的当前目录或快捷方式的起始位置影响：

```text
ZoHome/
├── ZoHome-win-x64.exe
├── zohome.env           # 首次启动生成的应用配置
├── data/                # 独立 SQLite 数据目录
│   ├── demo.sqlite      # 演示模式数据库
│   └── live.sqlite      # 真实模式数据库，启用后创建
└── credentials.json     # Google Ads 服务账号密钥，用户自行放入
```

首次运行会创建 `zohome.env`，其中包含演示模式配置、随机生成的 `APP_PASSWORD` 和稳定保存的 `TOKEN_ENCRYPTION_KEY`。密码和密钥不会输出到控制台。`credentials.json` 是可选的外部文件，使用 Google Ads 时自行提供；程序不会生成或打包真实密钥。

打开网页中的「系统设置」，可以编辑当前工作区的 `zohome.env`。页面自动识别配置项，以对应的中文注释作为标题，密码和密钥只显示是否已配置，留空保留原值。保存后关闭控制台并重新启动 EXE，配置才会生效。已有文件的注释可以直接修改，配置值保持不变即可。

数据库和 Google Ads 密钥使用独立路径，可在 `zohome.env` 或「系统设置」中配置：

```dotenv
DATA_DIR=./data
ADS_CREDENTIALS_FILE=./credentials.json
```

相对路径以 `zohome.env` 所在目录为准，也可分别填写绝对路径。配置、数据库和密钥均在 EXE 之外；移动整个工作区即可携带这些文件。若只将 EXE 移到另一个目录，默认会使用新目录中的工作区。

替换数据库或 Google Ads 权限文件时：

1. 关闭 ZoHome 控制台，确认原程序已经停止。
2. 备份当前 `zohome.env`、整个 `data` 目录和 `credentials.json`（如有）。SQLite 的 `-wal`、`-shm` 文件如存在，也须随数据目录一起保留。
3. 将目标数据库的整个数据目录替换到 `data`，或在 `DATA_DIR` 中指定目标目录。**数据库必须使用与其对应的原有 `TOKEN_ENCRYPTION_KEY`**，否则已有邮箱授权无法解密。
4. 如需更换 Google Ads 服务账号，用新的 JSON 替换 `credentials.json`，或修改 `ADS_CREDENTIALS_FILE`；经理号变更时同步修改 `ADS_MANAGER_ACCOUNT`。
5. 重新启动 EXE，确认数据及「刷新预算」读取权限。

更新程序时先关闭旧程序，只替换同目录中的 EXE，保留已有配置、`data` 和 `credentials.json`。新版启动会补齐旧 `zohome.env` 中缺少的配置项，保留已有值和 `TOKEN_ENCRYPTION_KEY`；数据库结构会自动升级，已有邮箱授权和返利网记录继续使用。不要用新生成的配置覆盖原有加密密钥。

旧版默认工作区位于 `%LOCALAPPDATA%\ZoHome`。新版不会自动迁移旧工作区：请先关闭旧程序，再把其中的 `zohome.env`、整个 `data` 目录和 `credentials.json`（如有）复制到 EXE 所在目录；也可以按下文设置 `ZOHOME_HOME`，继续使用原目录。若旧配置使用了其他绝对数据路径，迁移后仍按该配置读取。

需要自定义工作区位置时，在启动前设置 `ZOHOME_HOME`。例如，在 PowerShell 中运行：

```powershell
$env:ZOHOME_HOME = 'D:\ZoHomeData'
& '.\ZoHome-win-x64.exe'
```

`ZOHOME_HOME` 优先于 EXE 所在目录。此设置对当前 PowerShell 会话及其启动的程序生效；以后使用同一工作区时，需要继续设置相同的变量。直接双击 EXE 会使用其所在目录，除非已为该用户持久设置了 `ZOHOME_HOME`。

源码命令 `npm run start:desktop` 保留系统用户数据目录的默认行为，在 Windows 上为 `%LOCALAPPDATA%\ZoHome`；上述 EXE 旁的默认布局适用于打包后的可执行文件。

## 接入真实 Zoho 邮箱

1. 在「系统设置」中将运行模式改为真实邮箱，保存后关闭 ZoHome 控制台；也可以先关闭程序，再直接编辑配置文件。
2. 确认工作区 `zohome.env` 中的 `APP_MODE=live`，保留自动生成的 `TOKEN_ENCRYPTION_KEY`，并确认 `APP_PASSWORD` 至少有 12 个字符。
3. 页面和 OAuth 回调默认使用以下地址：

   ```dotenv
   FRONTEND_URL=http://localhost:3001
   ZOHO_REDIRECT_URI=http://localhost:3001/api/auth/zoho/callback
   ```

4. 在 [Zoho API Console](https://api-console.zoho.com/) 创建或编辑 **Server-based Application**，将授权回调登记为 `http://localhost:3001/api/auth/zoho/callback`。该地址必须与 `zohome.env` 一致。
5. 重新运行 EXE，使用 `zohome.env` 中的 `APP_PASSWORD` 登录工作区。
6. 在「邮箱账号」中添加邮箱，填写目标邮箱地址、Client ID 和 Client Secret，再前往 Zoho 官方页面完成授权。

每个独立邮箱分别授权。应用配置和授权令牌由本机服务端保存，Client Secret 和 Refresh Token 加密入库。可以为多个邮箱填写同一组应用信息，也可以为各个邮箱使用不同应用。

源码开发服务器使用 `http://localhost:5173`，而 EXE 默认使用 `http://localhost:3001`。若同一 Zoho 应用同时用于开发和 EXE，应在 Zoho 控制台登记各自准确的回调地址。

## 接入 Outlook 邮箱

先按上节将工作区切换为 `APP_MODE=live`。在 Microsoft Entra 注册应用，添加 **Web** 平台，并将重定向 URI 登记为：

```text
http://localhost:3001/api/auth/outlook/callback
```

该地址须与 EXE 实际使用的地址完全一致。默认配置为：

```dotenv
OUTLOOK_REDIRECT_URI=http://localhost:3001/api/auth/outlook/callback
OUTLOOK_TENANT=common
```

如果修改了端口，同时修改应用登记的回调地址。源码开发的 `5173` 端口不能代替 EXE 的 `3001`，回调不匹配会出现 `redirect_uri` 错误。

支持 Outlook.com、Hotmail 个人邮箱及具有 Exchange Online 邮箱的 Microsoft 365 工作或学校账号，使用 Microsoft 全球云端点。应用需要允许对应账号类型登录，并配置 `User.Read`、`Mail.Read`、`Mail.Send` 和 `offline_access` 委托权限；企业邮箱可能需要管理员批准。

在「邮箱账号 → 添加邮箱」中选择 Outlook，填写主邮箱地址、Client ID 和 Client Secret 的 **Value（值）**，前往微软页面授权。应用凭据按邮箱保存，不需要 Outlook JSON 文件。完整步骤见 [Outlook 接入说明](outlook.md)。

## Google Ads 刷新成本

将服务账号 JSON 放在 EXE 旁的工作区中：

```text
ZoHome-win-x64.exe
credentials.json
```

在「系统设置」或工作区的 `zohome.env` 中配置：

```dotenv
ADS_MANAGER_ACCOUNT=123-456-7890
ADS_CREDENTIALS_FILE=./credentials.json
ADS_API_VERSION=v26
```

相对密钥路径以 `zohome.env` 所在目录为准；使用 `ZOHOME_HOME` 时，把 JSON 放到自定义工作区，也可通过 `ADS_CREDENTIALS_FILE` 独立指定其他路径。密钥是外部文件，不会嵌入 EXE，分发 EXE 时也不会复制开发机密钥。更换 JSON 前关闭程序，替换后重新启动。

服务账号须具有经理号读取权限，其 Google Cloud 项目须能访问正式 Ads 账户。当前接入不需要 Developer Token。运行 EXE 的电脑需要能连接 Google OAuth 和 Google Ads API；修改配置后重启，再在「返利网」点击「刷新预算」，以美元累计消费覆盖保存成本。完整权限和分摊规则见 [Google Ads 成本刷新](google-ads.md)。

## 返利网功能

- 没有绑定邮箱时，也可直接输入邮箱地址新增返利网记录。此类邮箱显示“未知”，只保存在返利网，不加入邮箱账号或邮件页面。
- Offer 对比图合并当前筛选结果中的同名 Offer，汇总收益、成本后计算转化；明细记录仍分别保存。
- 总览显示净利润（USD），按当前筛选的总收益减总成本计算，亏损保留负数。

这些功能已包含在新版 EXE 中，无需安装额外组件。

## 从源码构建

构建机器需要 `.nvmrc` 指定的 **Node.js 22.22.2** 和 npm。此要求只针对构建机器，使用 EXE 的用户不需要安装它们。

在项目根目录运行：

```sh
nvm use
npm install
npm run package:win
```

输出目录：

```text
release/
├── ZoHome-win-x64.exe
├── ZoHome-win-x64.exe.sha256
├── data/                      # 新分发目录中为空
├── README.md
└── …                          # 接入说明及依赖许可证
```

打包过程会构建前端和服务端，下载对应版本的官方 Windows x64 Node.js 运行时，校验官方 SHA-256，再将应用和静态页面注入可执行文件，同时准备独立的空 `data/` 目录。构建包含所需源代码和编译资产，不会将开发机的 `.env`、运行数据库、邮箱授权或 Google Ads 密钥复制进分发文件。重复打包不会清空已有 `release/data/`，也不会覆盖已有 `release/zohome.env` 或 `release/credentials.json`。

可使用 PowerShell 计算最终文件的 SHA-256：

```powershell
Get-FileHash '.\release\ZoHome-win-x64.exe' -Algorithm SHA256
```

当前产物未附带代码签名证书。macOS 可以交叉构建 Windows EXE，但不能直接执行它；Windows 实际启动、浏览器打开、授权回调及关闭控制台后的退出行为，需要在 Windows 环境验证。

## 运行范围

EXE 默认只在本机提供服务。2000 个真实邮箱的批量授权、限流和持续同步验证，仍沿用主 README 中的分阶段验证要求；打包为 EXE 不改变 Zoho、Microsoft 或 Google Ads 的 API 权限及额度。
