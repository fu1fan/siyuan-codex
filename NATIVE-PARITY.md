# 内置智能体对照：0.2.0

参考思源开源仓库 revision `158812497497c6fa8a6d1031bfa2f025a61ee5c2`（2026-10-01 获取）。

| 思源实现 | 插件实现与行为 |
| --- | --- |
| [AgentChat.ts](https://github.com/siyuan-note/siyuan/blob/158812497497c6fa8a6d1031bfa2f025a61ee5c2/app/src/layout/dock/agent/AgentChat.ts) | `src/ui.ts`：紧凑图标标题栏、会话列表、用户气泡、助手正文、底部输入区、发送/停止切换、回到底部 |
| [AgentComposer.ts](https://github.com/siyuan-note/siyuan/blob/158812497497c6fa8a6d1031bfa2f025a61ee5c2/app/src/layout/dock/agent/AgentComposer.ts) | `src/native-composer.ts`：公开 Protyle lite 编辑器、Markdown、块引用、原生提示菜单、撤销/重做；`src/composer.ts`：输入历史 |
| [fragmentEditor.ts](https://github.com/siyuan-note/siyuan/blob/158812497497c6fa8a6d1031bfa2f025a61ee5c2/app/src/protyle/lite/fragmentEditor.ts) | 无持久文档 ID 的编辑器；发送时提取引用、卸载时清理编辑器/提示浮层 |
| [Files.ts](https://github.com/siyuan-note/siyuan/blob/158812497497c6fa8a6d1031bfa2f025a61ee5c2/app/src/layout/dock/Files.ts) 与 editorCommonEvent.ts | `src/context.ts`：siyuan-file/documents/gutter/block-ref/document-tab 载荷；复制效果、去重、已声明跨库来源的拒绝 |
| [_ai_agent.scss](https://github.com/siyuan-note/siyuan/blob/158812497497c6fa8a6d1031bfa2f025a61ee5c2/app/src/assets/scss/business/_ai_agent.scss) | `src/style.css`：沿用宿主图标、按钮、菜单及主题变量；插件样式限定 la-*，不覆盖内置智能体 |

## 功能边界

拖入文档／内容块和 `@` 选择笔记在正文插入原生块引用；内联 `[[` 引用同样会解析正文。图片及文件集中显示在上方卡片，混排中的原位置保留对应标记。笔记读取通过思源 API 完成，不依赖模型猜 ID，也不移动源笔记。工作目录、审批和模型通信仍由 Codex CLI 提供。

这不是内置智能体所有后端能力的完整移植。内置提供商配置、快照回滚、Token 圆环、技能管理不在本版范围。图片推理通过 Codex CLI 的 localImage 输入提供；其他文件通过本机路径读取。Codex 配置/技能/MCP 继续继承 CLI；文件权限不是 MCP 服务端写入权限。

## 验收边界

单元测试和隔离库正文读取集成测试通过；浏览器真实鼠标拖拽已验证多笔记标签与发送，但使用合成笔记和模拟回复。原生 Protyle 的桌面拖拽、引用提示和渲染需在桌面窗口操作恢复后完成，不能用浏览器 textarea 预览替代。
