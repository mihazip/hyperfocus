---
name: logins
description: Give the agent browser (ghostfox) your Firefox logins for some sites, for this session only. Only the user runs it.
argument-hint: "[domains... | off]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/ghostfox.mjs" grant $ARGUMENTS`

The text above is the result of the user's `/ghostfox:logins` command. Tell the user in one or two plain sentences which sites the agent browser can now use their logins for, and that every other site opens logged out. If the result shows an error, tell the user what to type instead.

Do not browse now unless the user asked for it. Never run `ghostfox.mjs grant` yourself, and never write to `~/.ghostfox/grants`: only the user gives logins, with this command.
