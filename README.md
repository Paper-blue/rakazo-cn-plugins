# Rakazo 国内服务插件源

自建的 Rakazo 插件市场来源，补充 Cursor、xAI 之外的国内云服务。原有的 Cursor 与 xAI 源不受影响。

## 内容

| 插件 | 服务 | 地址 | 凭据 |
| --- | --- | --- | --- |
| `tencent-yuanbao-search` | 腾讯云元宝联网搜索（SearchPro） | `https://api.wsa.cloud.tencent.com/Mcp` | 调用工具需腾讯云联网搜索 API Key |
| `dashscope-websearch` | 阿里云百炼 WebSearch | `https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp` | 需 DashScope API Key（Bearer） |

## 格式约束

Rakazo 对插件有完整性检查：不能包含 `rules/`、`hooks/`、`automations/` 目录或 `.lsp.json`；技能附件只能是 md/mdx/txt/json/yaml/csv；`mcp.json` 只接受 `streamable-http` / `sse` / `http` 的 `https://` 远程地址，且不允许 `${...}` 凭据占位符。因此本仓库只收录「纯远程 MCP」插件，不打包脚本附件。

## 使用

在 Rakazo 的插件市场里即可看到上述插件（需自托管实例通过 `RAKAZO_EXTRA_REGISTRIES` 指向本仓库）。

## 说明

本项目只提供插件描述，不代理、不改写任何厂商服务；各服务的可用性、鉴权方式、计费与条款以厂商官方为准。
