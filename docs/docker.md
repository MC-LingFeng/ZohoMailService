# Docker 使用与持久化

ZoHome 使用一个容器提供构建后的 React 页面和 NestJS API，容器内使用 Node.js 22。生产运行不依赖 Vite 开发服务器，宿主机无需安装 Node.js 或 npm。

需要 Docker，以及 **Docker Compose v2**。以下命令均在项目根目录执行。

多账号部署、初始管理员、工作区配置及保留现有数据卷的升级步骤见 [多账号与工作区](multi-workspace.md)。

## 准备配置

默认挂载宿主机的以下路径：

| 宿主机路径           | 容器路径                 | 用途                     |
| -------------------- | ------------------------ | ------------------------ |
| `./ZohoService/.env` | `/app/config/zohome.env` | 可读写的应用配置文件     |
| `./ZohoService/data` | `/app/data`              | 可读写的 SQLite 数据目录 |

**已有 `ZohoService/.env` 时直接使用，勿用示例覆盖。** 首次创建时执行：

```sh
test -f ZohoService/.env || cp docker.env.example ZohoService/.env
mkdir -p ZohoService/data
```

首次使用时，网页地址及回调可使用 Docker 默认的 3001 端口：

```dotenv
FRONTEND_URL=http://localhost:3001
ZOHO_REDIRECT_URI=http://localhost:3001/api/auth/zoho/callback
```

复用已有配置时，也可以保留原来的访问地址和回调。例如原配置使用 `http://localhost:5173`，将 `ZOHOME_PORT` 设为 `5173` 即可，无需修改应用配置或 Zoho 已登记的回调。

示例默认使用真实邮箱模式 `APP_MODE=live`，新部署须先将 `APP_PASSWORD` 替换为至少 12 个字符的初始管理员密码，将 `TOKEN_ENCRYPTION_KEY` 替换为 64 位十六进制的随机密钥。首次登录使用 `admin` 与该密码；初始化后修改 `.env` 不会重置平台账号密码，后续在「系统设置 → 账号密码」中修改。仅体验示例功能时，可改为 `APP_MODE=demo`。

复用已有真实邮箱数据库时，必须保留与该数据库对应的 `TOKEN_ENCRYPTION_KEY`，否则无法解密已有授权。邮箱 Client ID 和 Client Secret 继续在「邮箱账号」页面按账号填写。

首次更新到多工作区版本前，先停止旧服务并备份原配置和整个数据目录，再用原挂载启动新版。首次启动会自动创建平台目录库并将旧模式数据库接入默认工作区，保留原数据库和迁移快照；不要同时运行访问同一目录的旧版与新版。

容器内部的 `HOST`、`PORT` 和 `DATA_DIR` 由 Compose 固定设置，不使用配置文件中可能残留的本机监听地址或 Windows 绝对路径。对外访问地址由 `FRONTEND_URL` 和 `ZOHO_REDIRECT_URI` 决定。

## 启动、查看日志与停止

```sh
docker compose up -d --build
docker compose logs -f
```

默认打开 <http://localhost:3001>；配置了 `ZOHOME_PORT=5173` 时打开 <http://localhost:5173>。日志命令中的 **Ctrl+C** 只退出日志查看，不会停止后台容器。

停止应用：

```sh
docker compose down
```

配置和数据库是宿主机绑定挂载，停止或重新创建容器不会删除它们。

「系统设置」默认管理当前工作区配置，所有者保存后生效。平台管理员可在「平台设置」中修改所挂载的应用配置，页面保留文件注释；平台页的 `APP_PASSWORD` 及旧工作区连接字段只读，分别通过账号密码表单和工作区设置维护。密码和密钥留空保留原值。修改可编辑的平台配置后，需要重启服务重新读取：

```sh
docker compose restart
```

修改了挂载路径、端口绑定等 Compose 配置时，使用 `docker compose up -d --force-recreate` 重建容器配置。源代码更新后使用 `docker compose up -d --build` 重新构建并启动。

旧容器若仍以只读方式挂载配置文件，更新代码后使用 `docker compose up -d --build --force-recreate` 应用新的可写挂载。配置文件的宿主机权限也需要允许容器运行用户写入。

## 单独的 Docker 配置与数据路径

开发模式默认使用 5173 端口，Docker 默认使用 3001 端口。需要同时保留这两套配置时，使用单独的本地文件，例如 `ZohoService/.env.docker`。已有真实配置可复制一份后，只调整 Docker 地址；不要因此生成新的密钥覆盖原有数据库对应的密钥。

在当前终端中指定挂载路径：

```sh
export ZOHOME_ENV_FILE=./ZohoService/.env.docker
export ZOHOME_DATA_DIR=./ZohoService/data
docker compose up -d --build
```

运行前应自行确认指定文件和目录已存在。配置文件可以是同一项目中的独立文件，也可以是宿主机的绝对路径。后续管理该部署时，应继续使用相同的路径变量；这些路径变量只决定挂载位置，不会自动复制、迁移或生成新的配置。

也可以单独指定一个新的数据目录，将 Docker 工作区与开发工作区完全分开。此时新目录不会自动获得旧目录中的账号记录。

Compose 支持以下宿主机变量：

| 变量                        | 默认值                       | 用途                             |
| --------------------------- | ---------------------------- | -------------------------------- |
| `ZOHOME_ENV_FILE`           | `./ZohoService/.env`         | 应用配置文件路径                 |
| `ZOHOME_DATA_DIR`           | `./ZohoService/data`         | 数据目录路径                     |
| `ZOHOME_BIND_HOST`          | `127.0.0.1`                  | 宿主机端口的绑定地址             |
| `ZOHOME_PORT`               | `3001`                       | 宿主机访问端口                   |
| `ZOHOME_UID` / `ZOHOME_GID` | `1000` / `1000`              | 容器运行用户，与本地文件权限对应 |
| `ZOHOME_NODE_IMAGE`         | `node:22.22.2-bookworm-slim` | 构建使用的 Node 基础镜像         |

这些变量也可以保存在项目根目录的 `.env` 中，Compose 会自动读取，之后启动、停止和更新都无需重新 `export`。根目录 `.env` 管理 Compose 的端口、挂载路径及运行用户，仍在文件中维护；「平台设置」管理挂载的服务端配置文件，工作区连接设置及账号密码由各自页面维护。例如保留现有的 5173 端口：

```dotenv
ZOHOME_PORT=5173
```

本次本机部署已创建根目录 `.env`，保存 `5173` 端口、当前用户的 UID/GID 和可访问的基础镜像源；原 `ZohoService/.env` 及数据库继续使用本地文件。根目录 `.env` 已被版本控制和镜像构建忽略。

容器内部始终使用 3001 端口。若修改 `ZOHOME_PORT`，也应同步修改浏览器访问地址、`FRONTEND_URL` 与 Zoho 回调中的宿主机端口。

## SQLite 数据与 Linux 权限

挂载整个数据目录，使平台目录库 `platform-<mode>.sqlite`、业务库 `workspaces/<UUID>/<mode>.sqlite` 及其 `-wal`、`-shm` 文件一起持久化。不要只挂载单个 `.sqlite` 文件。备份时先停止应用，再一起备份整个数据目录与包含原平台加密密钥的对应配置。升级后顶层旧 `live.sqlite` 或 `demo.sqlite` 只是保留的原库，替换它不会替换活动工作区；恢复应使用配套的完整目录库、工作区目录与密钥。

本地 NestJS 服务和 Docker 容器不要同时使用同一数据目录。需要切换运行方式时，先停止正在访问该目录的服务。

容器默认以 UID **1000** 运行。这个用户需要读写配置文件和数据目录。macOS 或 Linux 上复用当前用户拥有的配置和数据时，可以直接使用相同 UID/GID，保持宿主机原有权限：

```sh
export ZOHOME_UID="$(id -u)"
export ZOHOME_GID="$(id -g)"
docker compose up -d --build
```

后续管理该部署时，继续使用相同的 UID/GID。如果目录就是为本容器创建，并选择由默认容器用户管理，也可手动设置数据目录所有者：

```sh
sudo chown -R 1000:1000 ./ZohoService/data
```

已有目录的所有权由宿主机管理员决定，镜像和启动流程不会自动改写它。配置文件也必须允许容器用户读写；不要通过向所有用户开放密钥文件来解决权限问题。

## 允许其他设备访问

默认端口仅绑定宿主机的 `127.0.0.1:3001`。需要局域网或服务器入口时，显式设置：

```sh
export ZOHOME_BIND_HOST=0.0.0.0
docker compose up -d --force-recreate
```

随后将配置中的 `FRONTEND_URL` 改为浏览器实际访问的地址，并将 `ZOHO_REDIRECT_URI` 设为该地址下的 `/api/auth/zoho/callback`。在 Zoho API Console 中登记完全一致的回调。`0.0.0.0` 是监听范围，不是浏览器访问地址。

例如，通过 HTTPS 反向代理使用 `https://mail.example.com` 时：

```dotenv
FRONTEND_URL=https://mail.example.com
ZOHO_REDIRECT_URI=https://mail.example.com/api/auth/zoho/callback
```

配置的访问地址同时用于来源校验与 Cookie 行为，应与浏览器实际使用的协议和域名一致。

## 构建范围

镜像构建只使用依赖清单、源代码和编译资产。`.env`、SQLite 数据、已有邮箱授权、EXE 发布产物等由构建上下文排除规则处理，不进入镜像。应用配置在运行时通过可读写挂载提供，数据库保留在宿主机数据目录中。

Docker 部署不会改变 Zoho API 的账号权限和额度。2000 个真实邮箱的规模验证仍需按主 README 的步骤分阶段进行。

如果 Docker Hub 无法访问，可以通过 `ZOHOME_NODE_IMAGE` 指定能够访问的 Node 22 基础镜像地址，再重新构建。例如使用 Google 的 Docker Hub 公共缓存：

```sh
export ZOHOME_NODE_IMAGE=mirror.gcr.io/library/node:22.22.2-bookworm-slim
docker compose up -d --build
```

该设置仅改变构建时的基础镜像来源，不改变本地配置和数据库挂载。

镜像已在当前 Docker 引擎构建后，可直接用 `docker compose up -d --no-build` 启动，避免再次请求基础镜像仓库。

## 部署验证

项目提供 `npm run test:docker`，在已构建 `zohome:local` 后验证真实容器的配置挂载、已有加密数据库、网页/API、停止与重建持久化。该检查仅使用独立临时 Compose 项目及测试文件，结束后会清理测试容器和目录，不使用现有邮箱数据。
