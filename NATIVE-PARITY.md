# UI API 与主题复用检查（2026-10-05）

本次依据项目安装的 `siyuan` 1.2.8 类型声明，以及本机 SiYuan 桌面构建的实际导出与渲染实现检查。插件运行时只调用公开 API，不复制宿主内部模块。

| 宿主能力 | 插件使用方式与本次处理 |
| --- | --- |
| `Plugin.addDock`、`addCommand`、`openTab` | 已用于侧栏、快捷入口及打开笔记，保持现有接入。 |
| `Dialog`、`showMessage` | 已用于设置、欢迎页、独立聊天窗口和消息通知，保持现有接入。 |
| `Protyle` lite 编辑器 | 输入区已使用，保留宿主块引用提示、编辑与撤销行为。 |
| `ProtyleMethod.highlightRender` | 本次接入助手 Markdown 代码块；输出 `.b3-typography .code-block code.hljs` 与父块 `data-language`，在内容挂载后调用。宿主负责语言库和主题样式。 |
| `codeBlockThemeLight` / `codeBlockThemeDark` | 完全沿用宿主选择与 `protyleHljsStyle` 更新；移除插件自带高亮库及独立明暗语法配色。 |
| `b3-button`、`b3-text-field`、`b3-select`、`block__icon`、`ariaLabel` | 已使用的宿主 CSS 控件。代码复制按钮也使用宿主按钮类；这些是样式约定，并非 JS 组件 API。 |
| `b3-slider` | 本次替换思考强度滑块的自绘轨道和滑块头，保留离散强度值、键盘输入及异步保存逻辑。 |
| `--b3-menu-background`、`--b3-dialog-shadow`、`--b3-theme-error` | 弹层表面、阴影和权限风险颜色改为宿主变量；代码背景使用 `--b3-protyle-code-background`。 |
| `Menu`、`confirm`、`openInputDialog`、`Setting` | 已核对公开接口。现有设置已经在原生 `Dialog` 中；搜索建议、多步骤目录选择、模型异步保存和行内会话删除具有自己的状态及焦点行为，保留业务容器，复用宿主控件和变量。宿主传入的笔记选区 `Menu` 继续直接扩展。 |
| `mathRender`、`mermaidRender`、`graphvizRender`、`chartRender` 等 | 公开富内容渲染 API 可用。现有公式/图表已加载宿主提供的 KaTeX/Mermaid 资源；本次保留其流式定界、隐藏历史延迟渲染、错误原文和 SVG 清理逻辑。其他图表种类不自动新增。 |

代码复制保留高亮前原文，避免宿主渲染补换行影响剪贴板；无语言及未知语言由宿主按纯文本处理；超过 50,000 字符的代码块保持纯文本，避免同步高亮阻塞界面。插件卸载时解除高亮适配器，不移除宿主共享的脚本或主题样式。

验证方式：`scripts/highlight-preview.mjs` 读取已安装桌面构建的高亮及代码主题模块，在浏览器中配合宿主实际 JS/CSS 资源验证四种配色和滑块交互。测试装配器只替换资源加载/模块边界，不模拟语法分析与配色；该方法不等同于原生桌面侧栏验收。最新证据见 `TESTING.md`。

---

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
