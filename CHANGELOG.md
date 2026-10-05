# Changelog

## 0.5.0

- 修复聊天代码块高亮，使用思源原生渲染接口，跟随思源的代码配色和明暗主题。
- 思考强度滑块、代码复制按钮及弹层样式复用思源控件和主题变量。
- 将运行中的会话数量移到标题栏 Codex 右侧，为会话标签留出空间。
- 保留代码复制原文，支持流式代码高亮；超长代码块降级为纯文本，避免阻塞界面。
- GitHub Release 说明仅包含当前版本更新，不再重复历史更新内容。

## 0.4.8

- Add note and chat text annotations with optional comments and compact source locations for reading surrounding context.
- Keep only the latest note selection in a separate removable chip; retain multiple annotations explicitly added through the note context menu.
- Show Copy and Add to conversation actions for selected chat text without automatically attaching it.
- Add editable annotation cards, preserve references on failed sends and isolate drafts by conversation.
- Keep annotation scrolling inside the rounded card with inset spacing.

## 0.4.7

- Restore the original Codex artwork and SVG mark in the marketplace icon, sidebar entry, empty chat and welcome page.
- Update the welcome-page preview to match the restored mark.
- Preserve the project MIT License and state third-party brand attribution separately in NOTICE.

## 0.4.6

First public release of SiYuan Codex.

- Publish under the MIT License with preserved third-party notices.
- Add Chinese and English user documentation, kernel-rendered note and plugin UI previews and marketplace metadata.
- Replace the extracted upstream mark with a project-drawn notebook/terminal icon.
- Add marketplace package verification and automated GitHub Releases.
- Include the existing sidebar chat, note references, attachments, concurrent sessions, local Codex history, model/permission controls and first-use CLI diagnostics.
