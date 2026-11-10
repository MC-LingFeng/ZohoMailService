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

打包后的 EXE 默认使用自身所在目录作为应用目录，不受启动终端的当前目录或快捷方式的起始位置影响。应用目录可包含多个独立业务工作区：

```text
ZoHome/
├── ZoHome-win-x64.exe
├── zohome.env           # 首次启动生成的应用配置
├── data/                # 平台目录库与完整工作区数据
│   ├── platform-demo.sqlite
│   ├── platform-live.sqlite     # 启用真实模式后创建
│   ├── workspaces/
│   │   └── <工作区 UUID>/
│   │       └── <mode>.sqlite    # 当前工作区实际业务库
│   └── backups/                # 旧单工作区升级快照与清单
└── credentials.json     # 旧版可选的外部 Google Ads 凭证，保留兼容
```

首次运行会创建 `zohome.env`，其中包含演示模式配置、随机生成的初始管理员密码 `APP_PASSWORD` 和稳定保存的 `TOKEN_ENCRYPTION_KEY`。密码和密钥不会输出到控制台。首次真实模式登录使用 `admin` 与该初始密码；此后使用平台账号当前密码，修改 `.env` 不会重置现有账号。程序不会生成或打包真实 Google Ads 凭证。

「系统设置」默认管理当前工作区的连接与同步配置，所有者保存后生效。平台管理员还可切换到「平台设置」维护 `zohome.env`，此类配置保存后须关闭控制台并重新启动 EXE。平台页的 `APP_PASSWORD`、已有平台加密密钥和旧工作区连接字段只读；登录密码通过「账号密码」表单修改，工作区字段通过「工作区设置」修改。密码、密钥和凭证 JSON 只返回是否已配置，留空保留原值。

完整数据目录可在 `zohome.env` 中配置：

```dotenv
DATA_DIR=./data
```

相对路径以 `zohome.env` 所在目录为准，也可填写绝对路径。配置、数据库和密钥均在 EXE 之外；移动完整应用目录即可携带这些文件。若只将 EXE 移到另一个目录，默认会使用新目录中的数据。

恢复备份或迁移数据时：

1. 关闭 ZoHome 控制台，确认原程序已经停止。
2. 备份当前 `zohome.env`、整个 `data` 目录和 `credentials.json`（如有）。SQLite 的 `-wal`、`-shm` 文件如存在，也须随数据目录一起保留。
3. 使用同一套备份恢复整个 `data`，包括 `platform-<mode>.sqlite`、`workspaces/`、迁移备份及 SQLite 辅助文件，或在 `DATA_DIR` 中指定目标完整目录。**须同时恢复对应的原 `TOKEN_ENCRYPTION_KEY`**，否则工作区密钥和已有授权无法解密。
4. 已升级后的活动业务库位于 `data/workspaces/<UUID>/<mode>.sqlite`。顶层旧 `live.sqlite` 或 `demo.sqlite` 仅保留原数据，替换它不会修改当前工作区；不要只替换单个库或只移动某一工作区目录。
5. 重新启动 EXE，确认工作区、原邮箱与关联数据。Google Ads 凭证或经理号需要变更时，在目标工作区的「工作区设置」中保存新值，再检查「刷新预算」。

更新程序时先关闭旧程序，备份配置与整个 `data`，再只替换同目录中的 EXE，保留已有配置、数据和 `credentials.json`。第一次启动多工作区版本会为原模式数据库制作一致性快照并接入默认工作区，保留原库、业务 ID、邮箱授权及返利网关联。新版也会补齐旧 `zohome.env` 中缺少的配置项，保留已有值和 `TOKEN_ENCRYPTION_KEY`。不要让旧版与新版同时访问同一目录，不要用新配置覆盖原密钥。完整步骤见 [多账号与工作区](multi-workspace.md)。

旧版默认应用目录位于 `%LOCALAPPDATA%\ZoHome`。新版不会自动把该目录搬到 EXE 旁：请先关闭旧程序，再把其中的 `zohome.env`、整个 `data` 目录和 `credentials.json`（如有）复制到 EXE 所在目录；也可以按下文设置 `ZOHOME_HOME`，继续使用原目录。首次新版启动才执行上述数据库接入流程。若旧配置使用了其他绝对数据路径，迁移后仍按该配置读取。

需要自定义工作区位置时，在启动前设置 `ZOHOME_HOME`。例如，在 PowerShell 中运行：

```powershell
$env:ZOHOME_HOME = 'D:\ZoHomeData'
& '.\ZoHome-win-x64.exe'
```

`ZOHOME_HOME` 优先于 EXE 所在目录。此设置对当前 PowerShell 会话及其启动的程序生效；以后使用同一工作区时，需要继续设置相同的变量。直接双击 EXE 会使用其所在目录，除非已为该用户持久设置了 `ZOHOME_HOME`。

源码命令 `npm run start:desktop` 保留系统用户数据目录的默认行为，在 Windows 上为 `%LOCALAPPDATA%\ZoHome`；上述 EXE 旁的默认布局适用于打包后的可执行文件。

## 接入真实 Zoho 邮箱

1. 平台管理员在「系统设置 → 平台设置」中将运行模式改为真实邮箱，保存后关闭 ZoHome 控制台；也可以先关闭程序，再直接编辑配置文件。
2. 确认工作区 `zohome.env` 中的 `APP_MODE=live`，保留自动生成的 `TOKEN_ENCRYPTION_KEY`，并确认 `APP_PASSWORD` 至少有 12 个字符。
3. 页面和 OAuth 回调默认使用以下地址：

   ```dotenv
   FRONTEND_URL=http://localhost:3001
   ZOHO_REDIRECT_URI=http://localhost:3001/api/auth/zoho/callback
   ```

4. 在 [Zoho API Console](https://api-console.zoho.com/) 创建或编辑 **Server-based Application**，将授权回调登记为 `http://localhost:3001/api/auth/zoho/callback`。该地址必须与 `zohome.env` 一致。
5. 重新运行 EXE，首次真实模式登录使用 `admin` 与 `zohome.env` 中的初始 `APP_PASSWORD`；已初始化的账号使用当前账号密码。
6. 选择目标工作区，在「邮箱账号」中添加邮箱，填写目标邮箱地址、Client ID 和 Client Secret，再前往 Zoho 官方页面完成授权。

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

在目标工作区的「系统设置 → 工作区设置」中填写 `ADS_MANAGER_ACCOUNT`、`ADS_API_VERSION`，并将服务账号 JSON 填入 `ADS_CREDENTIALS_JSON`。JSON 加密保存在平台目录库中，不回传原值；保存后该工作区后续刷新使用新配置，无需重启整个服务。

升级默认工作区时会导入已有 Ads 设置和存在的旧凭证文件，外部 `credentials.json` 仍保留。平台页的旧 `ADS_CREDENTIALS_FILE` 等字段为只读；导入后应通过工作区设置更换凭证，单独替换旧文件不会覆盖已保存的 JSON。分发 EXE 不会复制开发机密钥。

服务账号须具有经理号读取权限，其 Google Cloud 项目须能访问正式 Ads 账户。当前接入不需要 Developer Token。运行 EXE 的电脑需要能连接 Google OAuth 和 Google Ads API；在当前工作区的「返利网」点击「刷新预算」，以美元累计消费覆盖保存成本。完整权限和分摊规则见 [Google Ads 成本刷新](google-ads.md)。

## 返利网功能

- 没有绑定邮箱时，也可直接输入邮箱地址新增返利网记录。此类邮箱显示“未知”，只保存在返利网，不加入邮箱账号或邮件页面。
- Offer 对比图合并当前筛选结果中的同名 Offer，汇总收益、成本后计算转化；明细记录仍分别保存。
- 总览显示净利润（USD），按当前筛选的总收益减总成本计算，亏损保留负数。

这些功能已包含在新版 EXE 中，无需安装额外组件。

## 指纹浏览器管理

从当前源码构建的 EXE 提供 `/fingerprint-browsers` 页面，可新增、编辑、删除、搜索和分页查看指纹浏览器，保存序号、ID、窗口名称、代理信息和关联邮箱。关联邮箱与返利网页面共用，包含「未知」邮箱；鼠标悬浮或键盘聚焦邮箱时，可查看其 Offer 和返利网。

返利网表格显示浏览器的 ID 和序号。新增或编辑返利记录时，两项都不是必填项；需要关联时从下拉列表中选择已有浏览器，选择其中一项会同步另一项，不能任意填写。

返利网新增可选的「登录密码」字段，编辑时带出原密码，清空并保存即可删除；表格中的密码默认隐藏，可点击查看。密码保留首尾空格。新工作区使用独立业务密钥，原 `TOKEN_ENCRYPTION_KEY` 保护平台目录库中的工作区密钥；替换或迁移时须一起保留完整数据目录和原平台密钥。

管理页顶部的返利网热力总览以「窗口序号-ID」为左侧行表头、返利网名称为顶部列表头，色块显示返利网名称，绿色表示正常、红色表示已封户，中性色表示无关联账号。每条登记独立显示为一个色块，同一窗口、返利网下的多个 Offer 均保留。悬浮可查看 Offer、邮箱和密码，点击可固定详情，并支持分别复制邮箱、密码或一起复制。网站列根据可用宽度自动分组，内容完整展开，无内部滚动条。总览包含全部浏览器和登记信息，可独立搜索（含 Offer）及刷新，不受下方列表搜索和分页影响。已选择浏览器的登记只归属该浏览器，未选择浏览器的登记按手动关联邮箱匹配。

点击「导入 Excel」可选择 `.xlsx` 文件，文件须不超过 5 MB、数据不超过 10000 行。支持窗口导出模板的「序号、ID、窗口名称、代理信息」列，按列名识别并跳过说明行和「国家代码表」。请按以下步骤导入：

1. 选择文件，检查导入预览、当前浏览器数量和本次导入数量。
2. 注意「全部替换」提示：Excel 中没有的浏览器会被删除，其返利网记录会保留并解除浏览器关联；相同 ID 的浏览器保留原有关联。
3. 核对后勾选确认，再点击「确认导入并全部替换」。校验失败时原数据保持不变。

管理数据及关联关系保存在当前工作区的 `data/workspaces/<UUID>/<mode>.sqlite` 中；用户、成员和工作区密钥保存在 `data/platform-<mode>.sqlite`。启动时会自动升级已有数据库，无需额外数据库服务。

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
