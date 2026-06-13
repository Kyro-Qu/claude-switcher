# Claude Cookie Switcher

Chrome/Edge 扩展版 Claude 账号切换器。它使用浏览器原生 `chrome.cookies` API 保存和切换 `https://claude.ai/` 的登录 Cookie，支持 HttpOnly Cookie。

> Cookie 备份等同登录凭证。只保存你自己或家庭成员授权使用的账号，不要把导出的 JSON 发给不可信的人。

## 功能

- 保存当前 Claude 登录账号的 Cookie 快照
- 在多个账号之间切换、上一个、下一个
- 删除本地账号快照
- JSON 导入、导出全部、导出选中账号
- Cookie 权限诊断，不复制任何 Cookie 值
- 自动排除 `cf_clearance`、`__cf_bm`、`_cfuvid` 等 Cloudflare 风控 Cookie
- 切换后清理 Claude 前端缓存并刷新 Claude 标签页
- 数据只保存在浏览器本地扩展存储中

## 文件结构

- `extension/manifest.json`：Chrome/Edge Manifest V3 配置
- `extension/background.js`：Cookie 读写、切换和缓存清理逻辑
- `extension/core.js`：账号快照、导入导出、诊断等核心逻辑
- `extension/popup.html` / `popup.css` / `popup.js`：扩展弹窗界面
- `extension/extension-core.test.js`：扩展核心逻辑测试

## 安装

1. 打开浏览器扩展管理页：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 开启 `开发者模式`。
3. 点击 `加载已解压的扩展程序`。
4. 选择本仓库里的 `extension` 文件夹：

```text
D:\WorkSpace\Project\claude-switcher\extension
```

5. 工具栏出现 `Claude Cookie Switcher` 后即可使用。

## 保存账号

1. 打开 [https://claude.ai/](https://claude.ai/) 并正常登录一个 Claude 账号。
2. 点击浏览器工具栏里的扩展图标。
3. 在 `昵称` 输入框填写账号名称。
4. 点击 `保存当前`。
5. 成功时应看到 `sessionKey` 或 `sessionKeyV2` 的提示。
6. 登录另一个 Claude 账号后重复保存。

如果保存失败或诊断里没有 `sessionKey/sessionKeyV2`，说明扩展权限或当前登录状态异常。请确认扩展已启用、站点是 `https://claude.ai/`，然后重新登录 Claude 再保存。

## 切换账号

1. 打开扩展弹窗。
2. 在账号下拉框选择目标账号。
3. 点击 `切换选中`，也可以使用 `上一个` / `下一个`。
4. 扩展会删除当前 Claude Cookie、写入目标账号 Cookie、清理 Claude 前端缓存，并刷新 Claude 标签页。

如果切换后仍然不是目标账号，点击 `诊断`。诊断报告不包含 Cookie 值，可以用来确认是否读到了认证 Cookie。

## 导入导出

- `导出全部`：导出所有账号 JSON，并复制到剪贴板。
- `导出选中`：只导出当前选中账号 JSON。
- `导入`：把 JSON 粘贴到文本框后点击导入。

导出的 JSON 可以恢复登录状态，请按密码级别保存。旧备份如果没有 `sessionKey` 或 `sessionKeyV2`，不能用于真正切换账号。

## 诊断报告

点击 `诊断` 后，扩展会生成并复制一份不含 Cookie 值的 JSON，例如：

```json
{
  "api": "chrome.cookies",
  "cookieCount": 12,
  "httpOnlyCount": 2,
  "authCookieNames": ["sessionKeyV2"],
  "canSwitch": true
}
```

判断标准：

- `canSwitch: true`：读到了可切换账号所需的认证 Cookie。
- `authCookieNames` 包含 `sessionKey` 或 `sessionKeyV2`：账号快照可用于切换。
- `canSwitch: false`：当前没有读到认证 Cookie，需要重新登录 Claude 后保存。

## 权限说明

- `cookies`：读取和写入 `claude.ai` 的 HttpOnly 登录 Cookie。
- `storage`：把账号 Cookie 快照保存在浏览器本地。
- `tabs`：找到并刷新 Claude 标签页。
- `scripting`：在 Claude 标签页清理 `localStorage/sessionStorage`。
- `browsingData`：清理 Claude 的 IndexedDB、Cache、Service Worker 等前端缓存。
- `windows`：打开或聚焦 Claude 标签页所在窗口。

扩展的站点权限只包含：

```json
[
  "https://claude.ai/*",
  "https://*.claude.ai/*"
]
```

## 安全注意事项

- 导出的 JSON 可以让别人复用你的 Claude 登录状态，不要公开分享。
- 不要把备份上传到公开仓库、聊天群、公开网盘或不可信设备。
- 如果怀疑 Cookie 泄露，请退出 Claude 登录、修改密码，并重新登录生成新会话。
- Cloudflare 风控 Cookie 不会被保存或恢复，避免复用浏览器/IP 绑定的安全状态。
- Claude 官方如果调整登录机制，旧快照可能失效，需要重新登录保存。

## 本地测试

需要本机安装 Node.js。执行：

```powershell
node --check extension/core.js
node --check extension/background.js
node --check extension/popup.js
node --check extension/extension-core.test.js
node extension/extension-core.test.js
```

看到下面输出表示测试通过：

```text
All extension core tests passed.
```

## 版本

当前版本：`v1.2.0`

- `v1.2.0`：清理旧脚本和参考文件，仓库正式收束为 Chrome/Edge 扩展版
- `v1.1.0`：新增 Chrome/Edge Manifest V3 扩展版，使用 `chrome.cookies` 读写 HttpOnly Cookie
