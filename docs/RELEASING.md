# 发布

1. 更新 `plugin.json`、`package.json` 与 `package-lock.json` 的版本，并记录变化。
2. 执行 `npm ci`、`npm run check`、`npm test`、`npm run build`、`npm run verify:package`。
3. 在隔离思源工作区验证需要发布的界面与关键交互；分别记录 CI、内核和原生桌面证据。
4. 提交并推送源码，创建与版本一致的标签，例如 `v0.4.7`。Release 工作流构建并上传 `package.zip` 及带版本号的 ZIP。
5. 检查公开 Release 的文件，下载并确认 `package.zip` 的根目录直接包含 `plugin.json`、`index.js`、`index.css`、README、图标与预览图。

首次上架：fork [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar)，从最新 `main` 建分支，仅向 `plugins.txt` 添加 `fu1fan/siyuan-codex` 一行，按官方 PR 模板提交审核。上架需等待维护者合并；后续版本只需更新 Release，不重复申请。

发布包只包含运行文件、说明、截图与依赖许可证。源码通过公开仓库及 GitHub 标签提供，不打包本机工作区、会话、凭据、测试日志或开发依赖。

Release 正文由 `node scripts/release-notes.mjs` 从 `CHANGELOG.md` 提取与 `plugin.json` 版本完全匹配的一节；历史章节保留在仓库中，不重复发布到新版 Release。缺失或空章节会中止发布。
