# macOS、Linux、Windows 兼容说明

插件使用思源 3.8.6+ 的桌面 Electron 环境，在当前设备启动 Codex app-server。一个发布 ZIP 可用于三个桌面平台；不包含 Codex、Node.js 或任何平台的 CLI 二进制。

## CLI 安装和发现

先在当前操作系统安装并登录 Codex。官方步骤见 [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)；Windows 的原生沙箱设置见 [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)。插件沿用 CLI 的登录、`CODEX_HOME`、模型和沙箱配置。

| 平台 | 自动发现范围 | 手动查找 |
| --- | --- | --- |
| macOS | 当前 PATH、`~/.local/bin`、Homebrew、npm-global、mise、nvm、fnm、Volta、Bun | `command -v codex` |
| Linux | 当前 PATH、`~/.local/bin`、`~/bin`、系统 bin、npm-global、mise/XDG、nvm、fnm、Volta、Bun | `command -v codex` |
| Windows | 当前 PATH、`%APPDATA%\npm`、WinGet Links、Node.js、NVM、mise、fnm、Volta、Bun 和 Scoop shims 中的原生入口 | PowerShell：`(Get-Command codex).Source` |

桌面应用的 PATH 可能和终端不同。找不到 CLI 时，填写查找结果的完整路径。明确配置的路径优先，不会被另一份自动发现的 CLI 替换。自动搜索忽略 PATH 中的空项与相对目录。

Windows 支持原生 `codex.exe` 和 npm 标准的 `codex.cmd` / `codex.ps1`。npm 入口转换为相邻 `node_modules/@openai/codex/bin/codex.js`，由找到的 Node.js 执行；缺少 Node.js 时尝试 Electron 的 Node 模式。显式 JavaScript 入口也可使用。所有启动使用参数数组和 `shell:false`，无需 PowerShell 执行策略或命令行转义；自定义批处理包装器应改填原生可执行文件或 JavaScript 入口。

Windows 桌面思源需要 Windows CLI、Windows 目录和 Windows 登录。仅安装在 WSL 中的 Linux CLI 不会自动连接；若使用 Linux 思源，则在同一 Linux 环境安装 CLI。Linux 的 AppImage、Flatpak 等运行环境还必须允许创建子进程和访问所选目录，具体限制取决于发行方式。

## 目录、附件与退出

- 工作目录支持当前系统的绝对路径、`~/`、外层引号；Windows 还支持 `~\`、盘符和 UNC 路径。保留路径中的空格和中文。目录选择器沿用思源的 Electron 文件夹对话框。
- 默认无项目任务根目录沿用 Codex 的配置；未配置时使用当前用户的 `Documents/Codex`。附件、本机 CA 和旧插件迁移路径用系统路径 API 拼接。
- Windows 拖拽的工作区路径忽略大小写，并兼容 `/`、`\` 和尾部分隔符。macOS/Linux 保留大小写，避免把不同目录当作同一个库。附件仍验证真实路径范围，Windows junction 和 POSIX 符号链接不能越过资源目录。
- 关闭连接时，macOS/Linux 停止整个子进程组，并在 1.5 秒后清理残留进程；Windows 通过系统 `taskkill /T /F` 清理该会话的进程树。
- 思源同步的数据可能携带其他设备的 CLI 或项目绝对路径。换设备后需要选择本机有效路径；已开始会话的目录和文档绑定不会被静默改写。

## 开发与验收

三端使用 Node.js 22/24 执行 `npm ci`、`npm run check`、`npm test`、`npm run build`。测试入口在 Node 内枚举文件，打包使用 fflate，不依赖系统 shell 的 glob 或 `zip`。ZIP 条目统一使用 `/`，包含运行文件、文档、依赖许可证和源代码。

`tests/platform.test.ts` 在平台模拟环境中覆盖 CLI 发现、Windows 环境变量大小写、npm 启动、POSIX Node 安装定位、特殊字符路径、工作区比较和进程树退出。完整测试集还覆盖附件真实路径、目录绑定和连接生命周期。

当前 0.4.3 已在 macOS 完成类型检查、完整测试和真实 Codex CLI 0.159.0 握手；Windows/Linux 的分支已有模拟测试，三系统 CI 配置已加入，但本次未在 Windows/Linux 运行思源桌面实机验收。CI 执行结果需要在代码上传至 GitHub 后确认。

每个平台的桌面验收应包括：安装 ZIP、打开 Dock、CLI 登录/连接、中文或空格目录、文件夹选择、图片/文件附件、文档树拖拽、MCP 连接、停止后无残留 CLI 进程、插件重载及恢复会话。构建和模拟测试不能替代这些实机检查。
