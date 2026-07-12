# Using OpenABCode

This page collects day-to-day usage details that do not fit on the quickstart page.

## Interactive Mode

<p align="center"><img src="images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

The interface has four main areas:

- **Startup header** - shortcuts, loaded context files, prompt templates, skills, and extensions
- **Messages** - user messages, assistant responses, tool calls, tool results, notifications, errors, and extension UI
- **Editor** - where you type; border color indicates the current thinking level
- **Footer** - working directory, session name, token/cache usage, cost, context usage, and current model

The editor can be replaced temporarily by built-in UI such as `/settings` or by custom extension UI.

### Editor Features

| Feature | How |
|---------|-----|
| File reference | Type `@` to fuzzy-search project files |
| Path completion | Press Tab to complete paths |
| Multi-line input | Shift+Enter, or Ctrl+Enter on Windows Terminal |
| Images | Paste with Ctrl+V, Alt+V on Windows, or drag into the terminal |
| Shell command | `!command` runs and sends output to the model |
| Hidden shell command | `!!command` runs without sending output to the model |
| External editor | Ctrl+G opens `externalEditor`, `$VISUAL`, `$EDITOR`, Notepad on Windows, or `nano` elsewhere |

See [Keybindings](keybindings.md) for all shortcuts and customization.

## Slash Commands

Type `/` in the editor to open command completion. Extensions can register custom commands, skills are available as `/skill:name`, and prompt templates expand via `/templatename`.

| Command | Description |
|---------|-------------|
| `/login`, `/logout` | Manage OAuth or API-key credentials |
| `/model` | Switch models |
| `/route-model` | Select the authenticated model used to classify Route tasks |
| `/route` | Turn automatic task routing on or off |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/settings` | Thinking level, theme, message delivery, transport |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set session display name |
| `/session` | Show session file, ID, messages, tokens, and cost |
| `/tree` | Jump to any point in the session and continue from there |
| `/trust` | Save project trust decision for future sessions |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Manually compact context, optionally with custom instructions |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML or JSONL |
| `/import <file>` | Import and resume a session from a JSONL file |
| `/share` | Upload as private GitHub gist with shareable HTML link |
| `/reload` | Reload keybindings, extensions, skills, prompts, themes, and context files |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display version history |
| `/quit` | Quit openabcode |

## Message Queue

You can submit messages while the agent is still working:

- **Enter** queues a steering message, delivered after the current assistant turn finishes executing its tool calls.
- **Alt+Enter** queues a follow-up message, delivered after the agent finishes all work.
- **Escape** aborts and restores queued messages to the editor.
- **Alt+Up** retrieves queued messages back to the editor.

On Windows Terminal, Alt+Enter is fullscreen by default. Remap it as described in [Terminal setup](terminal-setup.md) if you want openabcode to receive the shortcut.

Configure delivery in [Settings](settings.md) with `steeringMode` and `followUpMode`.

## Sessions

Sessions are saved automatically to `~/.openabcode/agent/sessions/`, organized by working directory.

```bash
openabcode -c                  # Continue most recent session
openabcode -r                  # Browse and select a session
openabcode --no-session        # Ephemeral mode; do not save
openabcode --name "my task"    # Set session display name at startup
openabcode --session <path|id> # Use a specific session file or session ID
openabcode --fork <path|id>    # Fork a session into a new session file
```

Useful session commands:

- `/session` shows the current session file and ID.
- `/tree` navigates the in-file session tree and can summarize abandoned branches.
- `/fork` creates a new session from an earlier user message.
- `/clone` duplicates the current active branch into a new session file.
- `/compact` summarizes older messages to free context.

See [Sessions](sessions.md) and [Compaction](compaction.md) for details.

## Context Files

OpenABCode loads `AGENTS.md` or `CLAUDE.md` at startup from:

- `~/.openabcode/agent/AGENTS.md` for global instructions
- parent directories, walking up from the current working directory
- the current directory

Use context files for project conventions, commands, safety rules, and preferences. Disable loading with `--no-context-files` or `-nc`.

### System Prompt Files

Replace the default system prompt with:

- `.openabcode/SYSTEM.md` for a project
- `~/.openabcode/agent/SYSTEM.md` globally

Append to the default prompt without replacing it with `APPEND_SYSTEM.md` in either location.

### Project Trust

On interactive startup, openabcode asks before trusting a project folder that contains project-local settings, resources, or project `.agents/skills` and has no saved decision for the folder or a parent folder in `~/.openabcode/agent/trust.json`. Trusting a project allows openabcode to load `.openabcode/settings.json` and `.openabcode` resources, install missing project packages, and execute project extensions.

Before the trust decision, openabcode loads only context files, user/global extensions, and CLI `-e` extensions so they can handle the `project_trust` event. Project-local extensions, project package-managed extensions, and project settings are loaded only after the project is trusted. This split also applies when switching to a session from a different cwd whose trust has not been resolved in the current process.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore those project resources, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.openabcode/agent/settings.json`, or change it with `/settings`.

`openabcode config` and package commands use the same project trust flow, except `openabcode update` never prompts. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

Use `/trust` in interactive mode to save a project trust decision for future sessions, including trust for the immediate parent folder. It writes `~/.openabcode/agent/trust.json` only; the current session is not reloaded, so restart openabcode for changes to take effect.


## Exporting and Sharing Sessions

Use `/export [file]` to write a session to HTML.

Use `/share` to upload a private GitHub gist with a shareable HTML link.

If you use openabcode for open source work and want to publish sessions for model, prompt, tool, and evaluation research, see [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). It publishes sessions to Hugging Face datasets.

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
openabcode update --all              # Update openabcode and packages; reconcile pinned git refs
openabcode update --extensions       # Update packages only; reconcile pinned git refs
openabcode update --self             # Update openabcode only
openabcode update --extension <src>  # Update one package
openabcode list                      # List installed packages
openabcode config                    # Enable/disable package resources
```

These commands manage openabcode packages and `openabcode update` can update the openabcode CLI installation. To uninstall openabcode itself, see [Quickstart](quickstart.md#uninstall). `openabcode config` and project package commands accept `--approve`/`--no-approve` to trust or ignore project-local settings for one command. `openabcode update` never prompts for project trust.

See [OpenABCode Packages](packages.md) for package sources and security notes.

### Modes

| Flag | Description |
|------|-------------|
| default | Interactive mode |
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines; see [JSON mode](json.md) |
| `--mode rpc` | RPC mode over stdin/stdout; see [RPC mode](rpc.md) |
| `--export <in> [out]` | Export a session to HTML |

In print mode, openabcode also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | openabcode -p "Summarize this text"
```

### Model Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider, such as `anthropic`, `openai`, or `google` |
| `--model <pattern>` | Model pattern or ID; supports `provider/id` and optional `:<thinking>` |
| `--api-key <key>` | API key, overriding environment variables |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling |
| `--list-models [search]` | List available models |

### Session Options

| Option | Description |
|--------|-------------|
| `-c`, `--continue` | Continue the most recent session |
| `-r`, `--resume` | Browse and select a session |
| `--session <path\|id>` | Use a specific session file or partial UUID |
| `--fork <path\|id>` | Fork a session file or partial UUID into a new session |
| `--session-dir <dir>` | Custom session storage directory |
| `--no-session` | Ephemeral mode; do not save |
| `--name <name>`, `-n <name>` | Set session display name at startup |

### Tool Options

| Option | Description |
|--------|-------------|
| `--tools <list>`, `-t <list>` | Allowlist specific built-in, extension, and custom tools |
| `--exclude-tools <list>`, `-xt <list>` | Disable specific built-in, extension, and custom tools |
| `--no-builtin-tools`, `-nbt` | Disable built-in tools but keep extension/custom tools enabled |
| `--no-tools`, `-nt` | Disable all tools |

Built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.

### Resource Options

| Option | Description |
|--------|-------------|
| `-e`, `--extension <source>` | Load an extension from path, npm, or git; repeatable |
| `--no-extensions` | Disable extension discovery |
| `--skill <path>` | Load a skill; repeatable |
| `--no-skills` | Disable skill discovery |
| `--prompt-template <path>` | Load a prompt template; repeatable |
| `--no-prompt-templates` | Disable prompt template discovery |
| `--theme <path>` | Load a theme; repeatable |
| `--no-themes` | Disable theme discovery |
| `--no-context-files`, `-nc` | Disable `AGENTS.md` and `CLAUDE.md` discovery |

Combine `--no-*` with explicit flags to load exactly what you need, ignoring settings. Example:

```bash
openabcode --no-extensions -e ./my-extension.ts
```

### Other Options

| Option | Description |
|--------|-------------|
| `--system-prompt <text>` | Replace default prompt; context files and skills are still appended |
| `--append-system-prompt <text>` | Append to system prompt |
| `--verbose` | Force verbose startup |
| `-a`, `--approve` | Trust project-local files for this run |
| `-na`, `--no-approve` | Ignore project-local files for this run |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

### File Arguments

Prefix files with `@` to include them in the message:

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

# Model with provider prefix
openabcode --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
openabcode --model sonnet:high "Solve this complex problem"

# Limit model cycling
openabcode --models "claude-*,gpt-4o"

# Read-only mode
openabcode --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
openabcode --exclude-tools ask_question
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENABCODE_CODING_AGENT_DIR` | Override config directory; default is `~/.openabcode/agent` |
| `OPENABCODE_CODING_AGENT_SESSION_DIR` | Override session storage directory; overridden by `--session-dir` |
| `OPENABCODE_PACKAGE_DIR` | Override package directory, useful for Nix/Guix store paths |
| `OPENABCODE_OFFLINE` | Disable startup network operations, including update checks, package update checks, and install/update telemetry |
| `OPENABCODE_SKIP_VERSION_CHECK` | Skip the Pi version update check at startup. This prevents the `openabcode.com` latest-version request |
| `OPENABCODE_TELEMETRY` | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no`. This does not disable update checks |
| `OPENABCODE_CACHE_RETENTION` | Set to `long` for extended prompt cache where supported |
| `VISUAL`, `EDITOR` | Fallback external editor for Ctrl+G when `externalEditor` is unset; defaults to Notepad on Windows and `nano` elsewhere |

## Design Principles

OpenABCode keeps the core small and pushes workflow-specific behavior into extensions, skills, prompt templates, and packages.

It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. You can build or install those workflows as extensions or packages, or use external tools such as containers and tmux.

For the original rationale, read the [upstream design article](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/).
