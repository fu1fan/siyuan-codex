# SiYuan Codex

**English** · [简体中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/fu1fan/siyuan-codex)](https://github.com/fu1fan/siyuan-codex/releases/latest)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![SiYuan](https://img.shields.io/badge/SiYuan-3.8.6%2B-green)](https://b3log.org/siyuan/)

Continue using your Codex inside SiYuan Notes. Bring notes, attachments and local projects into a sidebar conversation powered by your local Codex CLI.

![SiYuan Codex: notes and sidebar chat](docs/images/chat.png)

*UI preview using the plugin’s own components and synthetic content. The note was rendered by an isolated SiYuan kernel; chat content is simulated. The plugin UI is currently primarily Simplified Chinese.*

## Features

- **Note context** — drag documents or blocks into chat, or reference notes with `@`, the add menu or `[[`. Read, search and edit through the current workspace's MCP tools.
- **Images and files** — paste or drop images, PDFs and other files. PDFs are read from their original local files, with relevant pages inspected when needed.
- **Persistent conversations** — keep history, drafts and attachments; run multiple chats concurrently with independent progress and approvals.
- **Local Codex history** — continue CLI, desktop and app-server threads, or attach another conversation as reference. External threads join plugin history after a successful send.
- **Models and permissions** — select CLI models, reasoning effort and fast mode; review command, file and MCP approvals.
- **Projects and directories** — use an independent projectless directory, choose a local project, or bind a document and its descendants to a directory.
- **Rich answers** — Markdown, tables, code copying, LaTeX and Mermaid, with collapsible working steps.
- **First-use setup** — check the CLI executable, version, connection and login status without issuing an inference request.

## Installation

Requires **SiYuan 3.8.6+ desktop** and **Codex CLI installed on the same operating system**. Supports macOS, Windows and Linux. Browser, mobile and Docker frontends are currently unsupported. Windows uses a native Windows CLI. See [platform compatibility and validation scope](COMPATIBILITY.md).

1. Install and sign in to Codex CLI following the [official quickstart](https://github.com/openai/codex#quickstart). Run `codex login` in your terminal. Model access follows your CLI account and provider configuration.
2. Once listed, search for **SiYuan Codex** in SiYuan's plugin marketplace and enable it. For manual installation, download `package.zip` from the [latest Release](https://github.com/fu1fan/siyuan-codex/releases/latest), extract into `<workspace>/data/plugins/siyuan-codex/`, then enable the downloaded plugin. `plugin.json` and `index.js` must be directly inside that directory.
3. The first-use welcome page checks your CLI automatically. Leave the executable field empty for auto-discovery or enter its full path. The plugin settings can reopen this page and rerun detection.
4. Open the right-side Codex dock, add a note and ask it to summarize the note or suggest next steps.

![Welcome page and CLI diagnostics](docs/images/welcome.png)

*Welcome-page UI preview with simulated detection results; no model inference was performed.*

## Everyday use

| Action | How |
| --- | --- |
| Open chat | Right-side Codex icon; `Alt+Shift+A` (`⌥⇧A` on macOS) |
| Send / newline | `Enter` / `Shift+Enter` |
| Reference notes | Drag documents or blocks; type `@` or `[[`; use the `+` menu |
| Attach files | Paste or drop; up to 20 MB per file and 20 reference items per turn |
| Command menu | Type `/` as the first character |
| Model, effort, fast mode | Model menu below the composer, or `/` menu |
| Permissions | Permission control below the composer and per-request approval cards |
| Directory or document binding | Folder button in the chat header |
| Find conversations | History button; switch between plugin history and all local Codex threads |

New chats use independent directories under Codex's projectless workspace root (normally `~/Documents/Codex`). Select a project before the first send. Started conversations retain their directory; document bindings apply to new chats.

## Data and permissions

The plugin starts local `codex app-server` processes and reuses CLI authentication, provider configuration, rules, skills and configured MCP servers. It does not rewrite `~/.codex/config.toml`.

The current SiYuan workspace is connected through its same-origin `/mcp` endpoint using the runtime token and local workspace CA. The token is not stored in plugin settings, chat history or command-line arguments. Note references initially supply IDs, titles and bounded attachment metadata; content is read on demand.

**File permissions and note-write permissions are separate.** The Codex sandbox governs local files and commands. SiYuan MCP settings govern the server's note tools. Disable MCP write tools in SiYuan if you want note access to remain read-only.

Messages, supplied references and agent-read content may be sent to the model service configured in Codex CLI. Plugin settings, directory bindings, history and attachment copies live in the current SiYuan workspace and may sync with it. Working directories and Codex history remain local to Codex. Deleting a plugin chat does not delete its files or delete/archive the Codex thread.

## Troubleshooting and limitations

- **CLI not found:** run `command -v codex` on macOS/Linux or `(Get-Command codex).Source` in Windows PowerShell, then enter the full executable path. Windows supports `.exe`, `.cmd` and `.ps1` launchers. Complete login in your terminal if diagnostics report that you are signed out.
- **Notes unavailable:** check the current SiYuan kernel's MCP status and exposed capabilities. A working CLI connection does not prove that note tools are connected.
- **Desktop threads missing:** select “全部 Codex” in history. Search covers titles from the same device and `CODEX_HOME`; cloud and other-device history are not included. Previewing an external thread does not add it to plugin history; a successful send does.
- **Other providers:** configure them through Codex CLI. Available models and fast mode depend on your CLI and provider.
- The UI is primarily Chinese. Mobile/browser support, skill slash menus and complex MCP OAuth forms are not implemented. PNG/JPEG/WebP/GIF are image inputs; other image formats are file attachments. Cross-platform CI and launcher tests do not replace native desktop validation on each OS.

## Development

Requires Node.js 22 or later.

```sh
git clone https://github.com/fu1fan/siyuan-codex.git
cd siyuan-codex
npm ci
npm run check
npm test
npm run build
npm run verify:package
```

Build outputs: `dist/`, `package.zip` and a versioned ZIP. CI checks Node.js 22/24 on macOS, Linux and Windows. A `v*` tag matching the manifest version builds and publishes a Release. See [release instructions](docs/RELEASING.md).

Use an isolated workspace for development. Details: [integration prompts](PROMPTS.md), [concurrent sessions](MULTI-SESSION.md), [working directories](WORKSPACES.md) and [host interaction references](NATIVE-PARITY.md).

For bugs, include the OS, SiYuan/plugin/CLI versions, reproduction steps and redacted logs in an [Issue](https://github.com/fu1fan/siyuan-codex/issues).

## Credits and license

Thanks to [SiYuan](https://github.com/siyuan-note/siyuan) for the plugin API, Protyle editor and rendering resources; [Codex CLI](https://github.com/openai/codex) for the agent runtime; and [Claudian](https://github.com/YishenTu/claudian) for local-agent workflow inspiration. Documentation structure was informed by [Document Flow](https://github.com/frostime/sy-docs-flow) and [Query & View](https://github.com/frostime/sy-query-view).

Project code and documentation use the [MIT License](LICENSE). Third-party dependencies retain their licenses; see [NOTICE](NOTICE). This is an independent community plugin, unaffiliated with OpenAI or the SiYuan team.
