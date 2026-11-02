# Windows EXE 使用与构建

ZoHome 的 Windows 分发文件是 `ZoHome-win-x64.exe`，适用于 Windows x64。它将 Node.js 运行时、NestJS 服务端和构建后的 React 页面合并为一个可执行文件。用户无需另行安装 Node.js、npm，或启动 Vite 开发服务器。

## 启动和停止

1. 将 `ZoHome-win-x64.exe` 放到本机方便访问的目录。
2. 双击运行。程序会打开一个控制台窗口，并自动在默认浏览器中打开 <http://localhost:3001>。
3. 如果浏览器没有自动打开，手动访问上面的地址。
4. 使用结束后，在控制台按 **Ctrl+C**，或者直接关闭该控制台窗口。网页和 API 属于同一个应用进程，会一起停止。

控制台窗口在使用期间需要保持打开。仅关闭浏览器标签页不会停止服务，再次打开 <http://localhost:3001> 可以继续访问。

默认启动演示模式，所有示例邮件与模拟发件都保存在本地，不会向真实收件人投递。

## 配置与数据

工作区默认位于：

```text
%LOCALAPPDATA%\ZoHome
```

可以在 Windows 资源管理器地址栏中粘贴这个路径。首次运行会创建 `zohome.env`，其中包含演示模式配置、随机生成的 `APP_PASSWORD` 和稳定保存的 `TOKEN_ENCRYPTION_KEY`。密码和密钥不会输出到控制台。

打开网页中的「系统设置」，可以编辑当前工作区的 `zohome.env`。页面自动识别配置项，以对应的中文注释作为标题，密码和密钥只显示是否已配置，留空保留原值。保存后关闭控制台并重新启动 EXE，配置才会生效。已有文件的注释可以直接修改，配置值保持不变即可。

配置与数据库都保存在 EXE 之外。因此，替换或移动 EXE 不会自动清除账号数据，程序更新也不需要重新分发数据库。备份工作区时，应保留数据库及其对应的加密密钥；更换密钥会使旧授权无法解密。

升级时先关闭旧程序，再替换 EXE，继续使用原工作区。新版启动会补齐旧 `zohome.env` 中缺少的配置项，保留已有值和 `TOKEN_ENCRYPTION_KEY`；数据库会自动迁移，已有邮箱授权和返利网记录继续使用，无需重新录入。不要用新生成的配置覆盖原有加密密钥。

需要自定义工作区位置时，在启动前设置 `ZOHOME_HOME`。例如，在 PowerShell 中运行：

```powershell
$env:ZOHOME_HOME = 'D:\ZoHomeData'
& '.\ZoHome-win-x64.exe'
```

此设置对当前 PowerShell 会话及其启动的程序生效。以后使用同一工作区时，需要继续设置相同的 `ZOHOME_HOME`；直接双击 EXE 会使用默认位置。

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

将服务账号 JSON 放在工作区中：

```text
%LOCALAPPDATA%\ZoHome\credentials.json
```

在「系统设置」或工作区的 `zohome.env` 中配置：

```dotenv
ADS_MANAGER_ACCOUNT=123-456-7890
ADS_CREDENTIALS_FILE=./credentials.json
ADS_API_VERSION=v26
```

相对密钥路径以工作区为准；使用 `ZOHOME_HOME` 时，把 JSON 放到自定义工作区。密钥是外部文件，不会嵌入 EXE，分发 EXE 时也不会复制开发机密钥。

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

输出文件：

```text
release/ZoHome-win-x64.exe
```

打包过程会构建前端和服务端，下载对应版本的官方 Windows x64 Node.js 运行时，校验官方 SHA-256，再将应用和静态页面注入可执行文件。构建包含所需源代码和编译资产，不会将开发机的 `.env`、运行数据库、邮箱授权或 Google Ads 密钥复制进分发文件。

可使用 PowerShell 计算最终文件的 SHA-256：

```powershell
Get-FileHash '.\release\ZoHome-win-x64.exe' -Algorithm SHA256
```

当前产物未附带代码签名证书。macOS 可以交叉构建 Windows EXE，但不能直接执行它；Windows 实际启动、浏览器打开、授权回调及关闭控制台后的退出行为，需要在 Windows 环境验证。

## 运行范围

EXE 默认只在本机提供服务。2000 个真实邮箱的批量授权、限流和持续同步验证，仍沿用主 README 中的分阶段验证要求；打包为 EXE 不改变 Zoho、Microsoft 或 Google Ads 的 API 权限及额度。
