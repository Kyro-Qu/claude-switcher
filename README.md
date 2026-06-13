# Claude Cookie 切换器

一个用于 `https://claude.ai/` 的 Tampermonkey 油猴脚本，可以在同一浏览器里保存多个 Claude 登录 Cookie 快照，并在家庭成员账号之间快速切换。

> Cookie 备份等同登录凭证。请只保存和导入你自己或家庭成员授权使用的账号，不要把导出的 JSON 发给不可信的人。

## 功能

- 保存当前已登录的 Claude 账号 Cookie 快照
- 在已保存账号之间切换、上一个、下一个、指定序号切换
- 删除本地保存的账号快照
- JSON 导入、导出和复制当前账号备份
- 本地保存数据，不上传到任何服务器
- 面板可拖拽、可最小化
- 自动排除 `cf_clearance`、`__cf_bm`、`_cfuvid` 等 Cloudflare 风控 Cookie，降低触发封锁页的概率
- 切换账号后自动清理 Claude 前端缓存，并强制整页刷新

## 文件说明

- `Claude Cookie 切换器.user.js`：油猴脚本本体
- `claude-switcher.test.js`：Node.js mock 测试
- `Grok SSO Cookie 切换器-5.9.txt`：参考脚本

## 安装准备

1. 安装浏览器扩展 Tampermonkey。
2. 建议使用 Tampermonkey Beta，因为 Claude 的登录 Cookie 通常包含 `HttpOnly`，普通版本可能无法完整读取或写入。
3. 打开 Tampermonkey 管理面板，新建脚本。
4. 将 `Claude Cookie 切换器.user.js` 的全部内容复制进去并保存。
5. 打开或刷新 [https://claude.ai/](https://claude.ai/)。

安装成功后，页面右侧会出现 `Claude 账号助手` 浮窗。

## 第一次保存账号

1. 在 `claude.ai` 正常登录第一个 Claude 账号。
2. 点击浮窗里的 `保存当前`。
3. 输入账号昵称，例如 `爸爸`、`妈妈`、`工作号`。
4. 看到保存成功提示后，这个账号的 Cookie 快照就保存到 Tampermonkey 本地了。
5. 退出或切换浏览器登录状态，再登录第二个 Claude 账号，重复上述步骤。

如果提示没有读取到 Cookie，或提示缺少 `sessionKey/sessionKeyV2`，通常说明 Tampermonkey 没有拿到 `HttpOnly` Cookie。请确认使用 Tampermonkey Beta，并重新登录 Claude 后再保存。

## 遇到 Cloudflare blocked 页面

如果安装或切换后看到：

```text
Sorry, you have been blocked
You are unable to access claude.ai
```

通常是 Cloudflare 风控 Cookie 被旧快照恢复、Cookie 状态异常、VPN/IP 风控或浏览器环境触发了 Claude 的安全服务。推荐按顺序处理：

1. 先在 Tampermonkey 中禁用本脚本。
2. 打开浏览器设置，清理 `claude.ai` 的站点数据和 Cookie。
3. 关闭代理/VPN，或换回稳定的常用网络。
4. 重新打开 [https://claude.ai/](https://claude.ai/) 并正常登录。
5. 更新到 `v1.0.1` 或更新版本的脚本后，再点击 `保存当前` 重新保存账号。

`v1.0.1` 起脚本会自动排除 Cloudflare 相关 Cookie；旧 JSON 备份导入时也会过滤这些 Cookie。

## 切换账号

保存至少两个账号后，可以使用以下按钮：

- `切换选中`：切换到下拉框里选中的账号
- `上一个` / `下一个`：按保存顺序循环切换
- `指定序号`：输入账号序号后切换
- `删除账号`：只删除本地保存的 Cookie 快照，不会删除 Claude 账号

切换时脚本会先删除当前 `claude.ai` Cookie，再写入目标账号保存的 Cookie，随后清理 Claude 的前端缓存并强制刷新页面。如果 Cookie 已过期，可能需要重新登录对应账号并重新点击 `保存当前`。

如果点击切换后仍然显示原账号，请按顺序排查：

1. 确认安装的是 `v1.0.2` 或更新版本。
2. 确认使用 Tampermonkey Beta，并允许脚本使用 `GM_cookie`。
3. 导出账号 JSON，检查目标账号的 `cookies` 中是否包含 `sessionKey` 或 `sessionKeyV2`。
4. 如果没有这些认证 Cookie，请分别登录每个 Claude 账号后重新点击 `保存当前`。
5. 清理 `claude.ai` 站点数据后重新保存账号，避免旧快照继续复用。

## 导入与导出

### 导出全部账号

点击 `导出`，脚本会把所有已保存账号的 JSON 备份复制到剪贴板。

建议把备份保存在安全位置，例如本机加密笔记、密码管理器或受保护的离线文件中。

### 复制当前账号

在下拉框中选择账号后，点击 `复制当前`，只复制该账号的 JSON 备份。

### 导入备份

1. 点击 `导入`。
2. 粘贴之前导出的 JSON。
3. 点击导入按钮。

如果导入的账号 ID 与本地已有账号相同，会覆盖本地同 ID 账号；否则会新增账号。

## 数据保存位置

脚本使用 Tampermonkey 本地存储，主要键名：

- `claude_cookie_profiles_v1`
- `claude_current_profile_id`
- `claude_panel_state_v1`

删除脚本或清理 Tampermonkey 数据可能会删除这些本地账号快照。清理前请先导出备份。

## 安全注意事项

- 导出的 JSON 可以让别人复用你的 Claude 登录状态，请按密码级别保护。
- 不要把 JSON 上传到公开仓库、聊天群、网盘公开链接或不可信设备。
- 家庭成员账号应在授权范围内使用，不要保存陌生人或未经同意的账号。
- 如果怀疑 Cookie 泄露，请立即退出 Claude 登录、修改密码，并重新登录生成新会话。
- 账号切换依赖 Claude 当前 Cookie 机制，Claude 官方更新登录策略后，旧快照可能失效。

## 本地测试

需要本机安装 Node.js。执行：

```powershell
node --check "Claude Cookie 切换器.user.js"
node --check claude-switcher.test.js
node claude-switcher.test.js
```

看到 `All Claude switcher tests passed.` 表示 mock 测试通过。

## 版本

当前版本：`v1.0.2`

- `v1.0.2`：切换后清理 localStorage、sessionStorage、IndexedDB、Cache 和 Service Worker，并强制刷新页面
- `v1.0.1`：排除 Cloudflare 风控 Cookie，减少 `Sorry, you have been blocked` 的风险
- 支持 `claude.ai` Cookie 快照保存与切换
- 支持本地 JSON 导入导出
- 不包含 WebDAV 或任何远程同步
