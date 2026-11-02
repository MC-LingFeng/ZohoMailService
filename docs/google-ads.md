# Google Ads 累计成本刷新

在「返利网」页面点击「刷新预算」，应用会读取经理号下全部广告账户的广告系列消费，按名称匹配已有 Offer，将匹配成功的累计美元消费保存到当前工作区的 SQLite 数据库，并更新列表、汇总和对比图。

操作只在点击时执行，覆盖原成本，不会在已有成本上累加。刷新范围包含全部记录和已封户记录，与页面搜索、筛选和分页无关；应用只读取 Google Ads 报表，不会调整广告系列预算。

## 匹配和金额规则

- Offer 名称与广告系列名称去掉首尾空格后精确匹配，区分大小写。经理号下的子经理号及其广告账户一并查询。
- 查询直接读取广告系列的 `metrics.cost_micros`，无需广告组或广告一一对应。查询不设置日期范围，读取 API 当前可提供的历史累计消费，包括暂停和已移除的广告系列。
- 金额以广告账户的结算币种为准。只有 `USD` 账户的金额会写入，按整数微单位换算成美分并四舍五入，数据库保留两位小数。
- 同名广告系列先汇总消费，再按关联的不同邮箱均分。某邮箱的同一 Offer 有多条记录时，再均分该邮箱份额；不足一美分的尾差按稳定顺序分配，所有记录合计保持等于该 Offer 的累计消费，避免重复计入总成本。
- 空 Offer、未匹配、非 USD、金额无效等情况会跳过并提示，保留原成本。当前不自动换汇。
- 任一广告账户读取失败，整次操作不保存成本，避免将不完整的账户集合当成完整结果。刷新期间某 Offer 的关联记录被其他窗口修改时，该 Offer 整组保留原成本并提示，避免只保存部分分摊结果。

Google Ads 报表可能有延迟，历史消费也可能调整；这里保存的是本次查询返回的消费快照。若比对 Google Ads 页面，请使用全部日期，并检查页面是否隐藏已移除系列。[报表差异说明](https://developers.google.com/google-ads/api/docs/reporting/uireports)、[查询日期规则](https://developers.google.com/google-ads/api/docs/reporting/segmentation#rules_for_core_date_segment_fields)。

## Google 账户准备

1. 在 Google Cloud 中为服务账号所属项目启用 Google Ads API，并在 [Google Ads API Overview](https://console.cloud.google.com/apis/api/googleads.googleapis.com/overview) 中确认该项目已获正式广告账户访问权限。仅 Test 权限不能读取正式账户，可按需要申请 Explorer、Basic 或 Standard 权限。
2. 创建服务账号并下载 JSON 密钥。JSON 的 `type` 应为 `service_account`，其中包含 `client_email` 与 `private_key`。
3. 登录 Google Ads 经理号，在「管理 → 访问权限和安全」中，将 JSON 内的 `client_email` 添加为只读用户，并确认目标广告账户已关联该经理号。权限会沿经理号层级继承。[服务账号设置](https://developers.google.com/google-ads/api/docs/oauth/service-accounts)、[访问模型](https://developers.google.com/google-ads/api/docs/oauth/access-model)。

截至 2026 年 11 月，Google 已将 API 访问权限迁移到 Google Cloud 项目，Developer Token 于 2026 年 9 月 9 日停用，新接入无需申请或填写。旧配置中的 `ADS_DEVELOPER_TOKEN` 可保留，当前版本不依赖此配置，也不发送该请求头。[迁移说明](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)、[项目访问等级](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)。

## 本地源码运行

将 JSON 保存在 `ZohoService/credentials.json`，在现有 `ZohoService/.env` 中补充以下配置，保留已有邮箱密码、加密密钥和其他设置：

```dotenv
# Google Ads 经理号，可含连字符
ADS_MANAGER_ACCOUNT=123-456-7890
# 相对路径以当前应用配置文件所在目录为准
ADS_CREDENTIALS_FILE=./credentials.json
# Google Ads API 版本
ADS_API_VERSION=v26
```

`ADS_CREDENTIALS_FILE` 未配置时默认读取应用配置文件同目录下的 `credentials.json`，也可指定绝对路径。`ADS_API_VERSION` 默认是 `v26`，升级时请检查 [Google 官方版本停用日期](https://developers.google.com/google-ads/api/docs/sunset-dates)。配置变更后重启服务，再点击「刷新预算」。

密钥 JSON 和运行配置只在服务端读取，不返回浏览器，也不会进入源码版本控制或镜像。不要将密钥放入前端静态资源目录。

## Docker 运行

默认 Compose 只挂载应用配置和数据库。需要读取 Ads 时，加上可选的 `compose.ads.yaml`，它将密钥文件只读挂载到 `/app/config/credentials.json`：

```sh
docker compose -f compose.yaml -f compose.ads.yaml up -d --build
```

运行前确保 `ZohoService/credentials.json` 已存在，且容器运行用户可读。应用配置的默认挂载位置是 `/app/config/zohome.env`，因此上面的 `ADS_CREDENTIALS_FILE=./credentials.json` 在容器中也能定位该密钥。

若密钥在其他宿主机路径，在项目根目录的 Compose `.env` 中设置：

```dotenv
ZOHOME_ADS_CREDENTIALS_FILE=/absolute/path/to/credentials.json
```

该变量指定宿主机文件；应用内的 `ADS_CREDENTIALS_FILE` 应保持 `./credentials.json` 或 `/app/config/credentials.json`。不要在应用配置中填宿主机绝对路径。后续启动、重建、停止此部署时，继续使用同一组 `-f` 参数，例如：

```sh
docker compose -f compose.yaml -f compose.ads.yaml down
```

## Windows EXE 运行

将 JSON 放入工作区 `%LOCALAPPDATA%\ZoHome\credentials.json`，在同目录的 `zohome.env` 中添加上述 Ads 配置，然后重启 EXE。使用 `ZOHOME_HOME` 自定义工作区时，JSON 和配置也放到该工作区；相对路径以工作区为准。EXE 不包含开发机的 Ads 密钥。

## 常见提示

| 提示或现象 | 处理方式 |
| --- | --- |
| 未配置经理号或无法读取密钥 | 检查应用配置文件、JSON 路径和运行用户的读取权限，重启后重试。 |
| Google Cloud 项目未获正式账户访问权限 | 到服务账号所属项目的 Google Ads API Overview 申请合适的访问等级。 |
| 无权限访问经理号或广告账户 | 检查 JSON 中的服务账号邮箱是否已加入经理号，以及广告账户的关联关系。 |
| 未找到同名广告系列 | 检查名称大小写、经理号范围、广告账户是否仍关联。 |
| 同名系列或多条同名 Offer | 同名系列消费汇总后按不同邮箱均分，同邮箱多条记录继续均分；检查所关联邮箱是否正确。 |
| 非 USD | 当前跳过；如需换汇，应先确定汇率来源、日期和历史金额计算规则。 |
| 原成本未变化 | 查看本次刷新结果中的跳过原因；已保存的金额本就相同时也可能数值不变。 |
