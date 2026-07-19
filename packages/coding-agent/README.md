<p align="center">
  <a href="https://openabcode.com">
    <img alt="openabcode logo" src="docs/images/logo.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@openabcode/coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@openabcode/coding-agent?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

OpenABCode is a Route-first terminal coding agent. Each prompt can be classified before the main turn, routed to your configured ChatGPT, Gemini, or Claude family model, and then executed through the same local tool loop. Use your own provider keys or the OpenABCode AI gateway for managed model access.

Adapt openabcode to your workflows, not the other way around, without having to fork and modify openabcode internals. Extend it with TypeScript [Extensions](#extensions), [Skills](#skills), [Prompt Templates](#prompt-templates), and [Themes](#themes). Put your extensions, skills, prompt templates, and themes in [OpenABCode Packages](#openabcode-packages) and share them with others via npm or git.

OpenABCode ships with powerful defaults but skips features like sub agents and plan mode. Instead, you can ask openabcode to build what you want or install a third party openabcode package that matches your workflow.

OpenABCode runs in four modes: interactive, print or JSON, RPC for process integration, and an SDK for embedding in your own apps. See [openclaw/openclaw](https://github.com/openclaw/openclaw) for a real-world SDK integration.

## Table of Contents

- [Quick Start](#quick-start)
- [Providers & Models](#providers--models)
- [Route Mode](#route-mode)
- [Interactive Mode](#interactive-mode)
  - [Editor](#editor)
  - [Commands](#commands)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Message Queue](#message-queue)
- [Sessions](#sessions)
  - [Branching](#branching)
  - [Compaction](#compaction)
- [Settings](#settings)
- [Context Files](#context-files)
- [Customization](#customization)
  - [Prompt Templates](#prompt-templates)
  - [Skills](#skills)
  - [Extensions](#extensions)
  - [Themes](#themes)
  - [OpenABCode Packages](#openabcode-packages)
- [Programmatic Usage](#programmatic-usage)
- [Philosophy](#philosophy)
- [CLI Reference](#cli-reference)

---

## Quick Start

```bash
npm install -g --ignore-scripts @openabcode/coding-agent
```

`--ignore-scripts` disables dependency lifecycle scripts during install. OpenABCode does not require install scripts for normal npm installs.

Installer alternative:

```bash
curl -fsSL https://openabcode.com/install.sh | sh
```

Authenticate with an API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
openabcode
```

Or use your existing subscription:

```bash
openabcode
/login  # Then select provider
```

Then just talk to openabcode. By default, openabcode gives the model four tools: `read`, `write`, `edit`, and `bash`. The model uses these to fulfill your requests. Add capabilities via [skills](#skills), [prompt templates](#prompt-templates), [extensions](#extensions), or [openabcode packages](#openabcode-packages).

**Platform notes:** [Windows](docs/windows.md) | [Termux (Android)](docs/termux.md) | [tmux](docs/tmux.md) | [Terminal setup](docs/terminal-setup.md) | [Shell aliases](docs/shell-aliases.md)

---

## Providers & Models

For each built-in provider, openabcode maintains a list of tool-capable models, updated with every release. Authenticate via subscription (`/login`) or API key, then select any model from that provider via `/model` (or Ctrl+L).

**Subscriptions:**
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro (Codex)
- GitHub Copilot

**API keys:**
- Anthropic
- Ant Ling
- OpenAI
- Azure OpenAI
- DeepSeek
- NVIDIA NIM
- Google Gemini
- Google Vertex
- Amazon Bedrock
- Mistral
- Groq
- Cerebras
- Cloudflare AI Gateway
- Cloudflare Workers AI
- xAI
- OpenRouter
- Vercel AI Gateway
- ZAI Coding Plan (Global)
- ZAI Coding Plan (China)
- OpenCode Zen
- OpenCode Go
- Hugging Face
- Fireworks
- Together AI
- Kimi For Coding
- MiniMax
- Xiaomi MiMo
- Xiaomi MiMo Token Plan (China)
- Xiaomi MiMo Token Plan (Amsterdam)
- Xiaomi MiMo Token Plan (Singapore)

See [docs/providers.md](docs/providers.md) for detailed setup instructions.

**Custom providers & models:** Add providers via `~/.openabcode/agent/models.json` if they speak a supported API (OpenAI, Anthropic, Google). For custom APIs or OAuth, use extensions. See [docs/models.md](docs/models.md) and [docs/custom-provider.md](docs/custom-provider.md).

---

## Route Mode

Route mode classifies each non-empty prompt before the main agent turn and selects one configured execution model from the OpenAI, Google, or Anthropic family. The selected model then runs the normal agent and tool loop.

Configure Route in the TUI:

1. Run `/login` and configure the providers you want to use.
2. Run `/route-model` and select the authenticated model that classifies tasks. This does not change the active execution model.
3. Run `/model` and select one OpenAI-family model, one Google-family model, and one Anthropic-family model. Each selection is saved to its Route family.
4. Run `/route` and select `on`.

When Route is on, the footer shows the three configured execution models:

```text
Route · gpt-5.5 · gemini-3.5-flash · claude-opus-4.8
```

These are the available Route choices, not the latest classification result. Every completed classification is persisted in the session JSONL as an `openabcode-routing` entry with the classifier model, selected family, execution model, previous model, and timestamp.

Route can use direct providers, OpenRouter, or the OpenABCode gateway. For example, `openabcode/gemini-3.1-flash-lite` is registered locally under the `openabcode` provider and routed by the gateway to Google's upstream provider.

See [docs/usage.md#route-mode](docs/usage.md#route-mode) for settings JSON, audit examples, fallback behavior, and troubleshooting.

---

## Interactive Mode

The interface from top to bottom:

- **Startup header** - Shows shortcuts (`/hotkeys` for all), loaded AGENTS.md files, prompt templates, skills, and extensions
- **Messages** - Your messages, assistant responses, tool calls and results, notifications, errors, and extension UI
- **Editor** - Where you type; border color indicates thinking level
- **Footer** - Working directory, session name, total token/cache usage (`↑` input, `↓` output, `R` cache read, `W` cache write, `CH` latest cache hit rate), cost, context usage, current model

The editor can be temporarily replaced by other UI, like built-in `/settings` or custom UI from extensions (e.g., a Q&A tool that lets the user answer model questions in a structured format). [Extensions](#extensions) can also replace the editor, add widgets above/below it, a status line, custom footer, or overlays.

### Editor

| Feature | How |
|---------|-----|
| File reference | Type `@` to fuzzy-search project files |
| Path completion | Tab to complete paths |
| Multi-line | Shift+Enter (or Ctrl+Enter on Windows Terminal) |
| External editor | Ctrl+G opens `externalEditor`, `$VISUAL`, `$EDITOR`, Notepad on Windows, or `nano` elsewhere |
| Images | Ctrl+V to paste (Alt+V on Windows), or drag onto terminal |
| Bash commands | `!command` runs and sends output to LLM, `!!command` runs without sending |

Standard editing keybindings for delete word, undo, etc. See [docs/keybindings.md](docs/keybindings.md).

### Commands

Type `/` in the editor to trigger commands. [Extensions](#extensions) can register custom commands, [skills](#skills) are available as `/skill:name`, and [prompt templates](#prompt-templates) expand via `/templatename`.

| Command | Description |
|---------|-------------|
| `/login`, `/logout` | OAuth authentication |
| `/model` | Switch models |
| `/route-model` | Select the authenticated model used to classify Route tasks |
| `/route` | Turn automatic task routing on or off |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/settings` | Thinking level, theme, message delivery, transport |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set session display name |
| `/session` | Show session info (file, ID, messages, tokens, cost) |
| `/tree` | Jump to any point in the session and continue from there |
| `/trust` | Save project trust decision for future sessions (restart required) |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Manually compact context, optional custom instructions |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML or JSONL file |
| `/import <file>` | Import and resume a session from a JSONL file |
| `/share` | Upload as private GitHub gist with shareable HTML link |
| `/reload` | Reload keybindings, extensions, skills, prompts, themes, and context files |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display version history |
| `/quit` | Quit openabcode |

### Keyboard Shortcuts

See `/hotkeys` for the full list. Customize via `~/.openabcode/agent/keybindings.json`. See [docs/keybindings.md](docs/keybindings.md).

**Commonly used:**

| Key | Action |
|-----|--------|
| Ctrl+C | Clear editor |
| Ctrl+C twice | Quit |
| Escape | Cancel/abort |
| Escape twice | Open `/tree` |
| Ctrl+L | Open model selector |
| Ctrl+P / Shift+Ctrl+P | Cycle scoped models forward/backward |
| Shift+Tab | Cycle thinking level |
| Ctrl+O | Collapse/expand tool output |
| Ctrl+T | Collapse/expand thinking blocks |

### Message Queue

Submit messages while the agent is working:

- **Enter** queues a *steering* message, delivered after the current assistant turn finishes executing its tool calls
- **Alt+Enter** queues a *follow-up* message, delivered only after the agent finishes all work
- **Escape** aborts and restores queued messages to editor
- **Alt+Up** retrieves queued messages back to editor

On Windows Terminal, `Alt+Enter` is fullscreen by default. Remap it in [docs/terminal-setup.md](docs/terminal-setup.md) so openabcode can receive the follow-up shortcut.

Configure delivery in [settings](docs/settings.md): `steeringMode` and `followUpMode` can be `"one-at-a-time"` (default, waits for response) or `"all"` (delivers all queued at once). `transport` selects provider transport preference (`"sse"`, `"websocket"`, or `"auto"`) for providers that support multiple transports.

---

## Sessions

Sessions are stored as JSONL files with a tree structure. Each entry has an `id` and `parentId`, enabling in-place branching without creating new files. See [docs/session-format.md](docs/session-format.md) for file format.

### Management

Sessions auto-save to `~/.openabcode/agent/sessions/` organized by working directory.

```bash
openabcode -c                  # Continue most recent session
openabcode -r                  # Browse and select from past sessions
openabcode --no-session        # Ephemeral mode (don't save)
openabcode --name "my task"    # Set session display name at startup
openabcode --session <path|id> # Use specific session file or ID
openabcode --fork <path|id>    # Fork specific session file or ID into a new session
```

Use `/session` in interactive mode to see the current session ID before reusing it with `--session <id>` or `--fork <id>`.

### Branching

**`/tree`** - Navigate the session tree in-place. Select any previous point, continue from there, and switch between branches. All history preserved in a single file.

<p align="center"><img src="docs/images/tree-view.png" alt="Tree View" width="600"></p>

- Search by typing, fold/unfold and jump between branches with Ctrl+←/Ctrl+→ or Alt+←/Alt+→, page with ←/→
- Filter modes (Ctrl+O): default → no-tools → user-only → labeled-only → all
- Press Shift+L to label entries as bookmarks and Shift+T to toggle label timestamps

**`/fork`** - Create a new session file from a previous user message on the active branch. Opens a selector, copies the active path up to that point, and places the selected prompt in the editor for modification.

**`/clone`** - Duplicate the current active branch into a new session file at the current position. The new session keeps the full active-path history and opens with an empty editor.

**`--fork <path|id>`** - Fork an existing session file or partial session UUID directly from the CLI. This copies the full source session into a new session file in the current project.

### Compaction

Long sessions can exhaust context windows. Compaction summarizes older messages while keeping recent ones.

**Manual:** `/compact` or `/compact <custom instructions>`

**Automatic:** Enabled by default. Triggers on context overflow (recovers and retries) or when approaching the limit (proactive). Configure via `/settings` or `settings.json`.

Compaction is lossy. The full history remains in the JSONL file; use `/tree` to revisit. Customize compaction behavior via [extensions](#extensions). See [docs/compaction.md](docs/compaction.md) for internals.

---

## Settings

Use `/settings` to modify common options, or edit JSON files directly:

| Location | Scope |
|----------|-------|
| `~/.openabcode/agent/settings.json` | Global (all projects) |
| `.openabcode/settings.json` | Project (overrides global) |

See [docs/settings.md](docs/settings.md) for all options.

### Project Trust

On interactive startup, openabcode asks before trusting a project folder that contains project-local settings, resources, or project `.agents/skills` and has no saved decision for the folder or a parent folder in `~/.openabcode/agent/trust.json`. Trusting a project allows openabcode to load `.openabcode/settings.json` and `.openabcode` resources, install missing project packages, and execute project extensions.

Before the trust decision, openabcode loads only context files, user/global extensions, and CLI `-e` extensions so they can handle the `project_trust` event. Project-local extensions, project package-managed extensions, and project settings are loaded only after the project is trusted. This split also applies when switching to a session from a different cwd whose trust has not been resolved in the current process.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore those project resources, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.openabcode/agent/settings.json`, or change it with `/settings`.

`openabcode config` and package commands use the same project trust flow, except `openabcode update` never prompts. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

Use `/trust` in interactive mode to save a project trust decision for future sessions, including trust for the immediate parent folder. It writes `~/.openabcode/agent/trust.json` only; the current session is not reloaded, so restart openabcode for changes to take effect.

### Telemetry and update checks

OpenABCode has two separate startup features:

- **Update check:** fetches `https://openabcode.com/api/latest-version` to check whether a newer version exists. Disable it with `OPENABCODE_SKIP_VERSION_CHECK=1`. Disabling update checks only turns off this check.
- **Install/update telemetry:** after first install or a changelog-detected update, sends an anonymous version ping to `https://openabcode.com/api/report-install`. This setting also controls optional provider attribution headers for OpenRouter, Cloudflare, and direct NVIDIA NIM requests. Opt out by setting `enableInstallTelemetry` to `false` in `settings.json`, or by setting `OPENABCODE_TELEMETRY=0`. This does not disable update checks; OpenABCode may still contact `openabcode.com` for the latest version unless update checks are disabled or offline mode is enabled.

Use `--offline` or `OPENABCODE_OFFLINE=1` to disable all startup network operations described here, including update checks, package update checks, and install/update telemetry.

---

## Context Files

OpenABCode loads `AGENTS.md` (or `CLAUDE.md`) at startup from:
- `~/.openabcode/agent/AGENTS.md` (global)
- Parent directories (walking up from cwd)
- Current directory

Use for project instructions (`AGENTS.md`/`CLAUDE.md`), conventions, common commands. All matching files are concatenated.

Disable context file loading with `--no-context-files` (or `-nc`).

### System Prompt

Replace the default system prompt with `.openabcode/SYSTEM.md` (project) or `~/.openabcode/agent/SYSTEM.md` (global). Append without replacing via `APPEND_SYSTEM.md`.

---

## Customization

### Prompt Templates

Reusable prompts as Markdown files. Type `/name` to expand.

```markdown
<!-- ~/.openabcode/agent/prompts/review.md -->
Review this code for bugs, security issues, and performance problems.
Focus on: {{focus}}
```

Place in `~/.openabcode/agent/prompts/`, `.openabcode/prompts/`, or a [openabcode package](#openabcode-packages) to share with others. See [docs/prompt-templates.md](docs/prompt-templates.md).

### Skills

On-demand capability packages following the [Agent Skills standard](https://agentskills.io). Invoke via `/skill:name` or let the agent load them automatically.

```markdown
<!-- ~/.openabcode/agent/skills/my-skill/SKILL.md -->
# My Skill
Use this skill when the user asks about X.

## Steps
1. Do this
2. Then that
```

Place in `~/.openabcode/agent/skills/`, `~/.agents/skills/`, `.openabcode/skills/`, or `.agents/skills/` (from `cwd` up through parent directories) or a [openabcode package](#openabcode-packages) to share with others. See [docs/skills.md](docs/skills.md).

### Extensions

<p align="center"><img src="docs/images/doom-extension.png" alt="Doom Extension" width="600"></p>

TypeScript modules that extend openabcode with custom tools, commands, keyboard shortcuts, event handlers, and UI components.

```typescript
export default function (openabcode: ExtensionAPI) {
  openabcode.registerTool({ name: "deploy", ... });
  openabcode.registerCommand("stats", { ... });
  openabcode.on("tool_call", async (event, ctx) => { ... });
}
```

The default export can also be `async`. openabcode waits for async extension factories before startup continues, which is useful for one-time initialization such as fetching remote model lists before calling `openabcode.registerProvider()`.

**What's possible:**
- Custom tools (or replace built-in tools entirely)
- Sub-agents and plan mode
- Custom compaction and summarization
- Permission gates and path protection
- Custom editors and UI components
- Status lines, headers, footers
- Git checkpointing and auto-commit
- SSH and sandbox execution
- MCP server integration
- Make openabcode look like Claude Code
- Games while waiting (yes, Doom runs)
- ...anything you can dream up

Place in `~/.openabcode/agent/extensions/`, `.openabcode/extensions/`, or a [openabcode package](#openabcode-packages) to share with others. See [docs/extensions.md](docs/extensions.md) and [examples/extensions/](examples/extensions/).

### Themes

Built-in: `dark`, `light`. Themes hot-reload: modify the active theme file and openabcode immediately applies changes.

Place in `~/.openabcode/agent/themes/`, `.openabcode/themes/`, or a [openabcode package](#openabcode-packages) to share with others. See [docs/themes.md](docs/themes.md).

### OpenABCode Packages

Bundle and share extensions, skills, prompts, and themes via npm or git. Find packages on [npmjs.com](https://www.npmjs.com/search?q=keywords%3Api-package) or [Discord](https://discord.com/channels/1456806362351669492/1457744485428629628).

> **Security:** OpenABCode packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

```bash
openabcode install npm:@foo/openabcode-tools
openabcode install npm:@foo/openabcode-tools@1.2.3      # pinned version
openabcode install git:github.com/user/repo
openabcode install git:github.com/user/repo@v1  # tag or commit
openabcode install git:git@github.com:user/repo
openabcode install git:git@github.com:user/repo@v1  # tag or commit
openabcode install https://github.com/user/repo
openabcode install https://github.com/user/repo@v1      # tag or commit
openabcode install ssh://git@github.com/user/repo
openabcode install ssh://git@github.com/user/repo@v1    # tag or commit
openabcode remove npm:@foo/openabcode-tools
openabcode uninstall npm:@foo/openabcode-tools          # alias for remove
openabcode list
openabcode update                               # update openabcode only
openabcode update --all                         # update openabcode and packages
openabcode update --extensions                  # update packages only
openabcode update --self                        # update openabcode only
openabcode update --self --force                # reinstall openabcode even if current
openabcode update npm:@foo/openabcode-tools             # update one package
openabcode config                               # enable/disable extensions, skills, prompts, themes
```

Packages install to `~/.openabcode/agent/git/` (git) or `~/.openabcode/agent/npm/` (npm). Use `-l` for project-local installs (`.openabcode/git/`, `.openabcode/npm/`). Git `@ref` values are pinned tags or commits; pinned packages are skipped by `openabcode update --extensions` and `openabcode update --all`, so use `openabcode install git:host/user/repo@new-ref` to move an existing package to a new ref. Git packages install dependencies with `npm install --omit=dev` by default, so runtime deps must be listed under `dependencies`; when `npmCommand` is configured, git packages use plain `install` for compatibility with wrappers. If you use a Node version manager and want package installs to reuse a stable npm context, set `npmCommand` in `settings.json`, for example `["mise", "exec", "node@20", "--", "npm"]`.

Create a package by adding a `openabcode` key to `package.json`:

```json
{
  "name": "my-openabcode-package",
  "keywords": ["openabcode-package"],
  "openabcode": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Without a `openabcode` manifest, openabcode auto-discovers from conventional directories (`extensions/`, `skills/`, `prompts/`, `themes/`).

See [docs/packages.md](docs/packages.md).

---

## Programmatic Usage

### SDK

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@openabcode/coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

await session.prompt("What files are in the current directory?");
```

For advanced multi-session runtime replacement, use `createAgentSessionRuntime()` and `AgentSessionRuntime`.

See [docs/sdk.md](docs/sdk.md) and [examples/sdk/](examples/sdk/).

### RPC Mode

For non-Node.js integrations, use RPC mode over stdin/stdout:

```bash
openabcode --mode rpc
```

RPC mode uses strict LF-delimited JSONL framing. Clients must split records on `\n` only. Do not use generic line readers like Node `readline`, which also split on Unicode separators inside JSON payloads.

See [docs/rpc.md](docs/rpc.md) for the protocol.

---

## Philosophy

OpenABCode is aggressively extensible so it doesn't have to dictate your workflow. Features that other tools bake in can be built with [extensions](#extensions), [skills](#skills), or installed from third-party [openabcode packages](#openabcode-packages). This keeps the core minimal while letting you shape openabcode to fit how you work.

**No MCP.** Build CLI tools with READMEs (see [Skills](#skills)), or build an extension that adds MCP support. [Why?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)

**No sub-agents.** There's many ways to do this. Spawn openabcode instances via tmux, or build your own with [extensions](#extensions), or install a package that does it your way.

**No permission popups.** Run in a container, or build your own confirmation flow with [extensions](#extensions) inline with your environment and security requirements.

**No plan mode.** Write plans to files, or build it with [extensions](#extensions), or install a package.

**No built-in to-dos.** They confuse models. Use a TODO.md file, or build your own with [extensions](#extensions).

**No background bash.** Use tmux. Full observability, direct interaction.

Read the [upstream design article](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) for the original rationale.

---

## CLI Reference

```bash
openabcode [options] [@files...] [messages...]
```

### Package Commands

```bash
openabcode install <source> [-l]     # Install package, -l for project-local
openabcode remove <source> [-l]      # Remove package
openabcode uninstall <source> [-l]   # Alias for remove
openabcode update [source|self|openabcode]   # Update openabcode only, or one package source
openabcode update --all              # Update openabcode and packages
openabcode update --extensions       # Update packages only
openabcode update --self             # Update openabcode only
openabcode update --self --force     # Reinstall openabcode even if current
openabcode update --extension <src>  # Update one package
openabcode list                      # List installed packages
openabcode config                    # Enable/disable package resources
```

`openabcode config` and project package commands accept `--approve`/`--no-approve` to trust or ignore project-local settings for one command. `openabcode update` never prompts for project trust.

### Modes

| Flag | Description |
|------|-------------|
| (default) | Interactive mode |
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines (see [docs/json.md](docs/json.md)) |
| `--mode rpc` | RPC mode for process integration (see [docs/rpc.md](docs/rpc.md)) |
| `--export <in> [out]` | Export session to HTML |

In print mode, openabcode also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | openabcode -p "Summarize this text"
```

### Model Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider (anthropic, openai, google, etc.) |
| `--model <pattern>` | Model pattern or ID (supports `provider/id` and optional `:<thinking>`) |
| `--api-key <key>` | API key (overrides env vars) |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling |
| `--list-models [search]` | List available models |

### Session Options

| Option | Description |
|--------|-------------|
| `-c`, `--continue` | Continue most recent session |
| `-r`, `--resume` | Browse and select session |
| `--session <path\|id>` | Use specific session file or partial UUID |
| `--fork <path\|id>` | Fork specific session file or partial UUID into a new session |
| `--session-dir <dir>` | Custom session storage directory |
| `--no-session` | Ephemeral mode (don't save) |
| `--name <name>`, `-n <name>` | Set session display name at startup |

### Tool Options

| Option | Description |
|--------|-------------|
| `--tools <list>`, `-t <list>` | Allowlist specific tool names across built-in, extension, and custom tools |
| `--exclude-tools <list>`, `-xt <list>` | Disable specific tool names across built-in, extension, and custom tools |
| `--no-builtin-tools`, `-nbt` | Disable built-in tools by default but keep extension/custom tools enabled |
| `--no-tools`, `-nt` | Disable all tools by default |

Available built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

### Resource Options

| Option | Description |
|--------|-------------|
| `-e`, `--extension <source>` | Load extension from path, npm, or git (repeatable) |
| `--no-extensions` | Disable extension discovery |
| `--skill <path>` | Load skill (repeatable) |
| `--no-skills` | Disable skill discovery |
| `--prompt-template <path>` | Load prompt template (repeatable) |
| `--no-prompt-templates` | Disable prompt template discovery |
| `--theme <path>` | Load theme (repeatable) |
| `--no-themes` | Disable theme discovery |
| `--no-context-files`, `-nc` | Disable AGENTS.md and CLAUDE.md context file discovery |

Combine `--no-*` with explicit flags to load exactly what you need, ignoring settings.json (e.g., `--no-extensions -e ./my-ext.ts`).

### Other Options

| Option | Description |
|--------|-------------|
| `--system-prompt <text>` | Replace default prompt (context files and skills still appended) |
| `--append-system-prompt <text>` | Append to system prompt |
| `--verbose` | Force verbose startup |
| `-a`, `--approve` | Trust project-local files for this run |
| `-na`, `--no-approve` | Ignore project-local files for this run |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

### File Arguments

Prefix files with `@` to include in the message:

```bash
openabcode @prompt.md "Answer this"
openabcode -p @screenshot.png "What's in this image?"
openabcode @code.ts @test.ts "Review these files"
```

### Examples

```bash
# Interactive with initial prompt
openabcode "List all .ts files in src/"

# Non-interactive
openabcode -p "Summarize this codebase"

# Non-interactive with piped stdin
cat README.md | openabcode -p "Summarize this text"

# Named one-shot session
openabcode --name "release audit" -p "Audit this repository"

# Different model
openabcode --provider openai --model gpt-4o "Help me refactor"

# Model with provider prefix (no --provider needed)
openabcode --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
openabcode --model sonnet:high "Solve this complex problem"

# Limit model cycling
openabcode --models "claude-*,gpt-4o"

# Read-only mode
openabcode --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
openabcode --exclude-tools ask_question

# High thinking level
openabcode --thinking high "Solve this complex problem"
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENABCODE_CODING_AGENT_DIR` | Override config directory (default: `~/.openabcode/agent`) |
| `OPENABCODE_CODING_AGENT_SESSION_DIR` | Override session storage directory (overridden by `--session-dir`) |
| `OPENABCODE_PACKAGE_DIR` | Override package directory (useful for Nix/Guix where store paths tokenize poorly) |
| `OPENABCODE_OFFLINE` | Disable startup network operations, including update checks, package update checks, and install/update telemetry |
| `OPENABCODE_SKIP_VERSION_CHECK` | Skip the version update check at startup. This prevents the `openabcode.com` latest-version request |
| `OPENABCODE_TELEMETRY` | Override install/update telemetry and provider attribution headers. Use `1`/`true`/`yes` to enable or `0`/`false`/`no` to disable. This does not disable update checks |
| `OPENABCODE_CACHE_RETENTION` | Set to `long` for extended prompt cache (Anthropic: 1h, OpenAI: 24h) |
| `VISUAL`, `EDITOR` | Fallback external editor for Ctrl+G when `externalEditor` is unset; defaults to Notepad on Windows and `nano` elsewhere |

---

## Contributing & Development

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines and [docs/development.md](docs/development.md) for setup, forking, and debugging.

## License

AGPL-3.0

## See Also

- [@openabcode/ai](https://www.npmjs.com/package/@openabcode/ai): Core LLM toolkit
- [@openabcode/agent-core](https://www.npmjs.com/package/@openabcode/agent-core): Agent framework
- [@openabcode/tui](https://www.npmjs.com/package/@openabcode/tui): Terminal UI components


