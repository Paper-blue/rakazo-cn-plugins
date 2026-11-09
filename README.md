# Rakazo 国内插件市场

自托管 Rakazo 的**自维护国内插件来源**，格式与 Rakazo 内置的 Cursor / xAI 市场完全兼容：在 Rakazo 里配置这一条来源，就能同时看到本仓库自建的插件和聚合来的国内厂商插件。

## 使用

在 Rakazo 部署的 `.env` 里追加（本地派生镜像支持 `RAKAZO_EXTRA_REGISTRIES`）：

```json
[
  {
    "name": "国内服务",
    "repository": "https://github.com/paper-blue/rakazo-cn-plugins",
    "path": ".cursor-plugin/marketplace.json",
    "manifest": ".cursor-plugin/plugin.json",
    "componentIndex": ".cursor-plugin/plugin-index.json"
  }
]
```

注意：`repository` 必须**全小写**。Rakazo 会把插件来源路径转成小写后与配置的仓库地址做前缀比较，大小写不一致时插件会被静默丢弃。

## 内容

### 自建插件（`plugins/`）

直接放在本仓库、随仓库安装的插件，用来补上国内服务里没有现成兼容包的空白。

| 插件 | 服务 | 凭据 |
| --- | --- | --- |
| `tencent-yuanbao-search` | 腾讯云元宝联网搜索（SearchPro） | 调用工具需腾讯云联网搜索 API Key |
| `dashscope-websearch` | 阿里云百炼 WebSearch | 需 DashScope API Key（Bearer） |
| `bailian-enhanced-search` | [百炼增强搜索](https://help.aliyun.com/en/model-studio/token-plan-harness-tool) | 需相应 Token Plan 权益与百炼 API Key |
| `glm-web-search` | [智谱联网搜索](https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server) | 需 GLM Coding Plan API Key |
| `glm-web-reader` | [智谱网页读取](https://docs.bigmodel.cn/cn/coding-plan/mcp/reader-mcp-server) | 需 GLM Coding Plan API Key |
| `glm-zread` | [智谱开源仓库读取](https://docs.bigmodel.cn/cn/coding-plan/mcp/zread-mcp-server) | 需 GLM Coding Plan API Key |
| `tencent-docs` | [腾讯文档](https://developer.cloud.tencent.com/mcp/server/11803) | 腾讯文档个人 MCP Token，直接放入 Authorization 请求头 |
| `wps-365-calendar` | [WPS 365 日历](https://open.wps.cn/documents/app-integration-dev/mcp-server/use-guide) | WPS 365 企业应用、授权及用户 access token |
| `wps-365-docs` | [WPS 365 智能文档](https://open.wps.cn/documents/app-integration-dev/mcp-server/tools/mcp_kso-airpage) | WPS 365 企业应用、授权及用户 access token |
| `wps-365-dbsheet` | [WPS 365 多维表格](https://open.wps.cn/documents/app-integration-dev/mcp-server/tools/mcp_kso-dbsheet) | WPS 365 企业应用、授权及用户 access token |

WPS 日历、智能文档、多维表格已无凭据握手并列出工具；腾讯文档无凭据返回 401。它们尚未验证授权或实际调用。WPS 官方对接文档还要求在应用中关闭接口签名；具体是否适合由企业管理员评估。腾讯文档 Authorization 为 Token 原值，WPS 为 Bearer token。

这些新增地址只经过无凭据请求验证，尚未验证登录或工具调用。安装插件后需在 MCP 服务器设置里配置 `Authorization: Bearer <API Key>`；插件自带的「登录」按钮是否适用于这些服务尚未验证。不要把密钥提交到仓库。

### 聚合插件（`sources.json`）

按上游 commit 钉住的国内插件市场，通过 `componentIndex` 引用，不复制上游文件：

| 来源 | 仓库 |
| --- | --- |
| 火山引擎 | `volcengine/volcengine-agent-toolkit` |
| 百度智能云 | `baidubce/aihc-plugins` |
| SumSec 中文技能 | `SummerSec/SumSec-Skills` |
| 智谱 ZCode | `zai-org/zcode-plugins` |

插件内容、许可与更新以上游仓库为准；本仓库只维护「哪些插件、指向哪个提交、归到哪个分类」。

## 维护

```bash
node scripts/build-registry.mjs      # 重新生成 .cursor-plugin/marketplace.json 与 plugin-index.json
node scripts/validate-registry.mjs   # 按 Rakazo 的约束校验
node scripts/build-registry.mjs --check   # CI 用：生成结果与提交内容不一致就失败
```

- GitHub Actions：PR 上只校验；push / 每天定时 / 手动触发时会重新抓取上游并自动提交索引变化。
- 新增自建插件：在 `plugins/<name>/` 放 `.cursor-plugin/plugin.json` 和（可选的）`mcp.json`，再跑一次 `build`。
- 新增聚合来源：往 `sources.json` 里加一条 `{ id, label, repository, index, defaultCategory }`。

## 格式约束（Rakazo 会拒绝的情况）

- 插件名必须匹配 `^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`。
- `mcp.json` 只接受 `streamable-http` / `sse` / `http` 的 **https** 远程地址，只允许 `type` / `url` / `headers` 字段，且不允许 `${...}` 占位符。
- 凭据不能写进 URL 查询参数（`key` / `token` / `auth` 等会被拒绝）；需要鉴权的服务应在安装后配置连接器凭据。
- 浏览时 Rakazo 会过滤掉带 `rules/`、`hooks/`、`automations/`、`.lsp.json` 或脚本附件的插件（这些插件用 `componentIndex` 描述后仍可出现，安装时脚本类附件会作为「跳过项」列出）。
- 纯技能包不会出现在「集成」面板，它在账户菜单的「技能」里；「集成」只列带连接器的插件。

## 图标来源

腾讯文档和 WPS 的图标来自其官网发布的 favicon（分别为 `https://docs.idqqimg.com/tim/docs/desktop/favicon.ico` 和 `https://cloudcdn.qwps.cn/open/web_open-homepage/favicon.ico`），以 PNG 存储；智谱 Z.ai 和阿里云图标来自 [Simple Icons](https://github.com/simple-icons/simple-icons)，该项目代码按 [CC0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md) 发布，品牌标识仍受商标权约束。图标仅用于指代对应服务，市场不是官方出品。

## 说明

本仓库只提供插件清单与少量自建插件描述，不代理、不改写任何厂商服务；各服务的可用性、鉴权方式、计费与条款以厂商官方为准。

## 已知不兼容 / 未收录

- **腾讯云 CloudBase（`TencentCloudBase/CloudBase-AI-Toolkit`）**：`plugin/cloudbase` 与 `plugin/cloudbase-codex` 两条路径在 Rakazo 预览阶段都返回 400（`Could not preview a supported plugin from this repository`），收录后用户点「添加」必然失败，因此暂不列入。仓库本身的清单与 `mcp.json` 结构看起来正常，问题在 Rakazo 侧的解析，需单独排查。
- **智谱 ZCode 的 `.zcode-plugin` 清单**：Rakazo 需要打补丁（`MANIFESTS` 增加 `.zcode-plugin/plugin.json` / `.claude-plugin/plugin.json`）才能安装；未打补丁的实例仍能看到条目但安装会失败。
- 带 `hooks/`、`rules/` 或 `.py`/`.sh` 附件的上游插件：安装时这些部分会作为「跳过项」列出；技能文本仍会安装。
