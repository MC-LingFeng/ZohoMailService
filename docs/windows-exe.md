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

配置与数据库都保存在 EXE 之外。因此，替换或移动 EXE 不会自动清除账号数据，程序更新也不需要重新分发数据库。备份工作区时，应保留数据库及其对应的加密密钥；更换密钥会使旧授权无法解密。

需要自定义工作区位置时，在启动前设置 `ZOHOME_HOME`。例如，在 PowerShell 中运行：

```powershell
$env:ZOHOME_HOME = 'D:\ZoHomeData'
& '.\ZoHome-win-x64.exe'
```

此设置对当前 PowerShell 会话及其启动的程序生效。以后使用同一工作区时，需要继续设置相同的 `ZOHOME_HOME`；直接双击 EXE 会使用默认位置。

## 接入真实邮箱

1. 关闭 ZoHome 控制台，停止当前应用。
2. 打开工作区中的 `zohome.env`，将 `APP_MODE=demo` 改为 `APP_MODE=live`。保留自动生成的 `TOKEN_ENCRYPTION_KEY`，并确认 `APP_PASSWORD` 至少有 12 个字符。
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

打包过程会构建前端和服务端，下载对应版本的官方 Windows x64 Node.js 运行时，校验官方 SHA-256，再将应用和静态页面注入可执行文件。构建包含所需源代码和编译资产，不会将开发机的 `.env`、运行数据库或已有邮箱授权复制进分发文件。

可使用 PowerShell 计算最终文件的 SHA-256：

```powershell
Get-FileHash '.\release\ZoHome-win-x64.exe' -Algorithm SHA256
```

当前产物未附带代码签名证书。macOS 可以交叉构建 Windows EXE，但不能直接执行它；Windows 实际启动、浏览器打开、授权回调及关闭控制台后的退出行为，需要在 Windows 环境验证。

## 运行范围

EXE 默认只在本机提供服务。2000 个真实邮箱的批量授权、限流和持续同步验证，仍沿用主 README 中的分阶段验证要求；打包为 EXE 不改变 Zoho API 权限及账号额度。
