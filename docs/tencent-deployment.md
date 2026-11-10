# 腾讯云香港：本地发版、迁移与备份

适用于 Ubuntu Server 24.04 LTS、Docker Engine + Compose v2，2核2GB单实例。所有 `npm run release` 命令都在本机项目根目录执行；服务器只加载镜像，不编译源码。既有本机 `compose.yaml` 继续用于开发，生产使用独立的 `deploy/compose.yaml`。

## 1. 首次准备

本机使用 Node.js 22（已有 nvm 时执行 `nvm use 22.22.2`）、Docker Desktop/buildx、OpenSSH 和 tar。确认 Docker 正在运行，然后执行 `npm ci`。默认构建 `linux/amd64`，Mac ARM 也会生成指定的 Linux 架构镜像。

先在本机终端完成一次 SSH 登录，核对腾讯云控制台提供的服务器主机指纹，不要盲目接受陌生指纹：

```sh
ssh -p 22 ubuntu@YOUR_SERVER_IP
```

脚本使用 SSH 密钥或 ssh-agent，采用 `BatchMode=yes` 和严格主机指纹检查，不保存、传输登录密码。使用密码登录时，先在本机生成专用 SSH 密钥，将公钥加入服务器 `~/.ssh/authorized_keys`，验证密钥登录成功。私钥保留本机，可用 `ssh-add` 加入代理；不要提交仓库或发送给他人。远程 ubuntu 用户须能执行 `sudo -n true`。

腾讯云防火墙/安全组允许 SSH（默认22，建议限制来源）和网站80/443。应用3001只监听服务器本机，无须向公网开放。域名 A 记录只指向这台服务器；删除旧的 A 记录，检查 AAAA 不要指向其他机器。80/443不能被已有网站占用。使用 CDN 代理时需自行核对源站与证书配置。

```sh
npm run release -- init
```

编辑不入库的 `.deploy/production.json`：

```json
{
  "host": "YOUR_SERVER_IP",
  "user": "ubuntu",
  "port": 22,
  "directory": "/opt/zohome",
  "platform": "linux/amd64",
  "publicUrl": "https://mail.example.com",
  "sourceEnv": "ZohoService/.env",
  "sourceData": "ZohoService/data"
}
```

遇到 `Permission denied (publickey)` 且没有已有私钥时，可执行 `npm run release -- ssh-key`。它在本机 `.deploy/ssh/` 生成专用密钥（权限600，不入库），自动配置私钥路径，并生成 `.deploy/server-authorize.sh`。将这个说明文件中的公钥安装命令复制到腾讯云控制台的网页终端执行，再在本机重试SSH与doctor。这个专用密钥用于自动发版，没有口令，请保护本机文件；已有带口令私钥也可以改用 `sshIdentityFile` 配合ssh-agent。不要将私钥复制到服务器。

可选字段：`sshIdentityFile` 指定本机私钥路径（如 `/Users/you/.ssh/zohome`）；`adsCredentialsFile` 指定原外部 Ads JSON 凭据；`nodeImage` 指定可访问的 Node22 基础镜像，例如 `mirror.gcr.io/library/node:22.22.2-bookworm-slim`。路径相对项目根目录，也可使用绝对路径。根目录原 `.env` 中的本机 Compose 参数不会自动带到服务器。

本次提供的服务器信息已写入本机 `.deploy/production.json`，不提交到 Git；原账号密码和加密密钥没有改写。

```sh
npm run release -- doctor
```

预检查本机 Docker/buildx、服务器 SSH/sudo/Docker/Compose、可用内存/磁盘和域名解析。失败先处理相应提示，不要通过关闭主机指纹检查或开放3001绕过。

## 2. 首次迁移现有数据

**停止所有正在使用源数据目录的服务**，包括本机开发服务、Docker容器或EXE。确认部署配置中的 `sourceEnv`、`sourceData` 是实际在用的配置和完整数据目录，不是另一个空目录。

本机使用项目默认 Docker 时可执行 `docker compose stop`；使用其他启动方式时停止对应进程。迁移成功后本机原文件仍保留；服务器开始承接写入后，不再同时启动旧服务使用同一份授权。

```sh
npm run release -- migrate --source-stopped
```

这个参数表示操作者已经停止源服务，脚本无法发现所有其他机器或程序的写入。迁移前会检查 SQLite 完整性，生成逐文件 SHA256 清单，对比复制前后数据；远端验证全部文件，**只允许向尚未初始化的安装导入**，发现现有配置或数据即拒绝覆盖。

迁移包含平台账号库、所有工作空间目录及数据库、WAL/SHM、原配置和匹配的原加密密钥、可选外部 Ads 凭据。不会重置登录密码或重新生成 `TOKEN_ENCRYPTION_KEY`。服务器的网页地址、Zoho/Outlook回调将改成 `publicUrl`；外部 Ads 凭据挂载路径会改成容器内路径。

在 Zoho 和 Microsoft 应用后台登记完全一致的回调：

```text
https://你的域名/api/auth/zoho/callback
https://你的域名/api/auth/outlook/callback
```

迁移同时准备服务器目录与每天的备份定时器，并将备份解密密钥保存到本机 `.deploy/<服务器>-<目录标识>-backup.key`。这个文件与应用的 `TOKEN_ENCRYPTION_KEY` 不同：前者解密备份包，后者解密数据库中的授权。两者都要保存。

## 3. 日常发版

```sh
npm run release -- deploy
```

依次运行发版工具测试和项目测试，在本机构建目标 Linux 镜像，使用隔离数据执行真实容器的迁移、授权加密与重建持久化检查，再生成不可覆盖的版本号和 SHA256 清单，通过 SSH 上传。服务器校验包与镜像身份、CPU架构和 Compose 配置，预拉取 Caddy，然后暂停服务、备份完整运行数据、切换版本并检查 `/api/status`。成功后更新 `current` 指针，再开放网站入口。

上传内容只有镜像、版本元数据和部署工具，**不会再次上传本机数据库或覆盖服务器运行配置**。首次数据迁移必须单独执行。

需要分开构建和部署时：

```sh
npm run release -- build --version v20261110-1
npm run release -- deploy --release v20261110-1
```

同一个版本号不可重复发布。发布包保存在本机 `release/<版本>/`，请保留近期版本供回滚或灾难恢复。服务器不会自动清理历史镜像和上线前备份，磁盘不足时先检查版本依赖，再人工清理；不要使用会删除运行数据的广泛清理命令。

上传完成但在启动前校验失败时，修正问题后可以执行 `npm run release -- retry --release 版本号`，避免再次传输大镜像。只允许本地/远程校验清单相同、尚无运行状态和上线前快照的未激活版本；已成功上线或启动过的版本不能借此覆盖。镜像身份使用实际配置内容的SHA256，兼容经典Docker与Docker29的containerd存储。

```sh
npm run release -- status
npm run release -- logs
npm run release -- verify
```

首次上线后登录核对用户、工作空间、成员、邮箱、返利记录以及授权可用性。基础健康检查不能代替这些核对：部分工作空间按需加载，HTTP200不代表每个数据库都已验证。

域名正确解析且80/443可达后，Caddy自动申请和续期HTTPS证书。应用已健康但代理/证书配置失败时，命令会报错；此时当前应用版本已经提交，不会冒险自动覆盖可能产生的新数据，应修复入口后执行 `npm run release -- restart-proxy` 重试代理。

本地deploy/retry还会等待公网HTTPS，并检查ZoHome页面、匿名状态接口及业务接口401响应；这一步失败会明确提示应用已提交、应检查云端TCP443/域名/证书，避免把入口问题当作数据回滚的理由。修复云防火墙后可单独执行 `npm run release -- verify`。

## 4. 服务器目录

```text
/opt/zohome/
  bin/server.sh, crypto.mjs       管理与加密工具
  shared/
    zohome.env                   原应用配置及加密密钥
    data/                        平台库、各工作空间数据库、升级快照
    credentials.json             可选外部 Ads 凭据；无凭据时为空对象
    source-manifest.json         首次迁移清单
  releases/<版本>/               镜像包、清单、独立 Compose、上线前备份指针
  current -> releases/<版本>     当前成功版本
  backups/                       加密快照与校验文件
  secrets/backup.key             备份包解密密钥（不打入快照）
  proxy/                         HTTPS证书及代理运行数据
  recovery/                      恢复时保留的旧数据
```

单实例使用固定 Compose 项目 `zohome-prod`；本流程当前不支持同一服务器安装多套。应用以UID/GID1000运行，服务器脚本仅调整本安装目录内的文件权限。

## 5. 定时备份与异地副本

每日北京时间03:00，加最多5分钟随机延迟，由systemd timer触发。它与发版/恢复共用锁；若其他操作正在执行，当次备份会失败并记录日志，需要检查后补做。备份会短暂停止服务以获得账号库和全部工作空间的一致状态，完成后恢复运行；压缩或加密失败也会尝试恢复原服务。

备份使用随机密钥 AES-256-GCM认证加密，另附SHA256用于传输校验；解密认证成功前不输出任何明文。快照包含完整 `shared`、版本信息和逐文件清单，解密密钥单独保存。每天的快照保留最近14份；手动、上线前和安全快照不自动删除。每次发版前也会生成快照。

手动备份，并下载到本机：

```sh
npm run release -- backup
npm run release -- download-key
```

本机副本保存到 `release/backups/<服务器>/`，备份密钥保存到 `.deploy/`，均不入库。将密钥另外保存到密码管理器或安全离线介质；丢失后无法解密备份。加密快照不包含 Docker 镜像，因此配套版本包也应另存。

**每日任务默认只在服务器生成加密备份；异地上传需要配置目的地，不能把同机副本当成灾难备份。** 可以在服务器安装可执行的 `/opt/zohome/bin/backup-upload`，它接收两个参数：加密文件路径、SHA256文件路径，只有全部上传成功才退出0。例如已有独立SSH备份服务器时：

```sh
#!/usr/bin/env bash
set -euo pipefail
# 先在当前服务器准备专用SSH密钥、核对备份服务器指纹，并创建目的目录。
scp -o BatchMode=yes -o StrictHostKeyChecking=yes -- "$1" "$2" backup@BACKUP_HOST:/safe/zohome/
```

使用 `sudo chmod 700 /opt/zohome/bin/backup-upload` 设置执行权限。也可接入已有的 COS/rclone，但桶、凭据和流量费用由实际配置决定。上传失败会保留本机备份并使定时任务报错。日常发版和手动备份应检查异地副本，不能仅确认定时器已启用。

服务器检查命令：

```sh
sudo systemctl list-timers zohome-backup.timer
sudo journalctl -u zohome-backup.service -n 100 --no-pager
sudo systemctl start zohome-backup.service
```

## 6. 回滚与恢复

新版本在提交成功前启动失败，会尝试恢复上线前完整数据、配置及匹配的旧镜像；第一次部署失败则恢复导入时的数据并保持服务停止。恢复失败会明确报错并保留快照与恢复现场，不宣称回退成功。

**成功上线后的回滚会覆盖备份之后的新写入。** 必须显式传入 `--restore-data`，并先生成当前状态的安全快照。普通回滚只支持当前版本记录的上一个版本：

```sh
npm run release -- rollback v20261110-1 --restore-data
```

从服务器上某个快照恢复：

```sh
npm run release -- restore --backup /opt/zohome/backups/manual-时间戳.tar.gz.enc --restore-data
```

恢复前先验证SHA256、GCM认证、归档路径、逐文件清单和匹配版本元数据，然后暂停服务、生成安全快照并替换数据。原数据移动到 `recovery/` 保留。需要快照对应的旧版本仍安装在服务器，不能只回滚镜像。

服务器完全丢失时，先在本机用独立保存的备份密钥解密：

```sh
node scripts/deploy/crypto.mjs decrypt /安全位置/backup.key < backup.tar.gz.enc > backup.tar.gz
```

在受保护的临时目录检查并解包该快照，使用其中的 `shared/zohome.env` 和 `shared/data` 作为新安装配置的 `sourceEnv`、`sourceData`，如有外部凭据也指定 `adsCredentialsFile`。对新服务器重新完成 `doctor → migrate --source-stopped → deploy --release 原版本`，核对数据并测试登录。新服务器会生成新的备份包密钥；原数据库加密密钥仍随原配置迁移。恢复演练应使用隔离服务器或临时目录，禁止覆盖现用数据。

## 7. 没有域名时

可将新安装的 `publicUrl` 设为 `http://localhost:3001`，通过 `npm run release -- tunnel` 在本机访问，不启动公网代理。正式使用 OAuth 建议配置稳定 HTTPS 域名。已有安装不允许通过重复setup静默修改域名，需要单独维护配置与回调。
