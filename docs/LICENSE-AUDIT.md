# Publication license review

Reviewed on 2026-10-03 for the first public release, 0.4.6.

The earlier local package conservatively used AGPL and described host-layout
references as adaptation. The publication review compared the plugin modules
with the pinned host revision in NATIVE-PARITY.md: AgentChat.ts,
AgentComposer.ts, fragmentEditor.ts, _ai_agent.scss and kernel/agent/agent.go.
The plugin implements its own state, DOM views, history, prompt text and
protocol handling. Similarities found were public Protyle option names,
standard DOM operations, theme variable names and common flex declarations.
The host's implementation files are neither imported nor bundled.

As of 0.4.7 (2026-10-04), the original Codex mark and plugin artwork have
been restored from the local 0.4.5 package. The marketplace PNG is resized
to 160 by 160 pixels to meet the marketplace's icon size limit. These
third-party branding assets are not relicensed under this project's MIT
License; attribution and the independent-plugin notice are in NOTICE.

UI previews use synthetic demonstration notes rendered by an isolated
SiYuan kernel and simulated chat and diagnostic responses. They do not
grant rights to the host application's branding.

The project owner's first public release uses MIT. This applies to project
code and documentation. Bundled DOMPurify and marked retain their own license
notices, reproduced in package.zip. SiYuan and Codex CLI are separately
installed runtime applications and are not included in the package.
