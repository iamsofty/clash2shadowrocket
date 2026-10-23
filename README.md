# Clash2Shadowrocket

在浏览器本地把 Clash / Mihomo YAML 转换为 Shadowrocket CONF。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aiocy/clash2shadowrocket)

点击按钮即可在自己的 Cloudflare 账户创建 Worker，并启用 Workers Builds。完成首次部署后，生产分支每次推送都会自动重新构建和发布。

## 为什么是纯前端

Clash 配置通常包含节点密码、UUID、Reality 公钥和订阅信息。本项目不设置转换 API，文件通过浏览器 `File` API 读取，YAML 解析和 CONF 生成都在当前页面内完成。

部署后的页面使用 CSP 禁止网络请求：

```text
connect-src 'none'
```

这意味着转换页面无法把 YAML 上传到服务器。输出 CONF 中的远程规则 URL 只会在之后由 Shadowrocket 获取。

## 已实现

- 保留策略组名称与成员大小写；
- 支持 `select`、`url-test`、`fallback`、`load-balance`、`relay` 策略组；
- 把 `MATCH` 转为末尾的 `FINAL`；
- 完整保留 `RULE-SET` 的 `no-resolve`，避免 IP 类规则提前触发本地 DNS；
- 通用保留声明为文本或使用 `.list/.txt/.yaml/.yml` URL 的自定义 provider；
- 把常见 MetaCubeX `.mrs` 分类映射为 blackmatrix7 的 Shadowrocket 文本规则，包括 BiliBili 与 BiliBiliIntl；
- 允许在页面中用 `provider=https://...list` 为任意 `.mrs` 指定文本替代，也支持 YAML 扩展字段 `shadowrocket-url` / `text-url`；
- 未知 `.mrs` 会生成诊断和注释，不会输出可导致 `invalid encoding` 的规则；
- 从 Mihomo DNS 生成 Shadowrocket 直连 DNS、代理 DNS、fallback 和 DNS 劫持设置；
- 转换 Hosts；
- 可选注入国内、AI 前置规则和 `GEOIP,CN,DIRECT,no-resolve`；
- 可选把 Hysteria2、TUIC、VLESS 节点写入 `[Proxy]`；
- 不生成或复制 MITM 证书、密码。

## 推荐使用方式

默认保持“把节点写入 CONF”关闭：

1. 先用 Sub-Store 或原 Clash YAML 把节点导入 Shadowrocket；
2. 在本页面生成路由 CONF；
3. 把 CONF 导入 Shadowrocket 并选择“使用配置”；
4. 用 Shadowrocket 的“测试规则”检查国内域名、AI 服务和最终规则；
5. 再用 `ip.skk.moe` 分别验证国内、AI 和国外目标。

开启“把节点写入 CONF”后会生成自包含配置，但 Shadowrocket 的现代节点本地语法可能随版本变化，尤其应复核 VLESS Reality/Vision。

## 本地开发

需要 Node.js 22 或更高版本。

```powershell
npm.cmd install
npm.cmd run dev
```

测试与构建：

```powershell
npm.cmd test
npm.cmd run build
```

构建输出目录为 `dist`。

## 部署到 Cloudflare Workers

Cloudflare 当前建议新静态站点使用 Workers Static Assets。项目已经包含 `wrangler.jsonc`：

### 一键部署与 Git 自动同步

点击 README 顶部的 **Deploy to Cloudflare** 按钮，登录 Cloudflare 和 GitHub 后按页面提示完成部署。

如果不希望 Cloudflare 创建仓库副本，也可以在 Cloudflare 控制台选择：

1. **Workers & Pages → Create application → Import a repository**；
2. 选择 `aiocy/clash2shadowrocket`；
3. Production branch 选择 `main`；
4. Build command 填写 `npm run build`；
5. Deploy command 填写 `npx wrangler deploy`；
6. Root directory 保持仓库根目录。

连接完成后，向 `main` 推送更新会自动触发生产部署；其他分支或 Pull Request 可以生成预览部署。

### 本地直接部署

```powershell
npx.cmd wrangler login
npm.cmd run deploy
```

转换逻辑仍然只在浏览器执行，Worker 只负责分发 HTML、CSS 和 JavaScript。

## 部署到 Cloudflare Pages

两种方式都可以：

### Git 集成

- Build command：`npm run build`
- Build output directory：`dist`
- Root directory：仓库根目录

### Wrangler Direct Upload

先在 Cloudflare 创建 Pages 项目，然后执行：

```powershell
npm.cmd run build
npx.cmd wrangler pages deploy dist --project-name clash2shadowrocket
```

## 私有配置回归基准

仓库不包含真实配置或节点凭据。在开发目录上一级存在私有 `openclash.yaml` 时，测试套件会额外运行以下结构回归；公开仓库和 Cloudflare 构建会安全跳过这一项：

| 项目 | 结果 |
|---|---:|
| 读取节点 | 31 |
| 策略组 | 28 / 28 |
| 输入规则 | 79 |
| provider | 51 / 51 |
| 输出有效规则 | 100 |
| Shadowrocket 文本规则集 | 48 |
| `no-resolve` | 26（17 个规则集、8 个 IP 规则、1 个 GEOIP） |
| 未知 `.mrs` | 0 |
| MITM | 不生成 |

运行 `npm.cmd test` 会执行通用测试，并在私有回归文件存在时验证这些结构。

## 已知限制

- 不会下载并解码任意 `.mrs`；未知二进制源需要在页面中填写文本替代 URL，或在 YAML provider 中声明 `shadowrocket-url` / `text-url`；
- `proxy-provider` 无法在静态、离线转换时展开远程节点；
- Clash `nameserver-policy` 没有完全等价的 Shadowrocket 表达方式，会被归并成直连/代理 DNS；
- Clash 脚本、流量嗅探、TUN 栈等 Mihomo 专用能力不会转换；
- Rewrite、MITM 和证书不能从普通 Clash YAML 安全推导；
- 生成结果仍需在目标 Shadowrocket 版本中做规则测试。

## 主要目录

```text
src/converter/       转换核心、provider 映射和测试
src/App.tsx          浏览器界面与下载流程
public/_headers      Cloudflare 安全响应头
wrangler.jsonc       Workers Static Assets 配置
```

## 参考

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Pages Vite 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/)
- [Shadowrocket 社区使用手册](https://github.com/LOWERTOP/Shadowrocket)
- [blackmatrix7 Shadowrocket 规则](https://github.com/blackmatrix7/ios_rule_script/tree/master/rule/Shadowrocket)
