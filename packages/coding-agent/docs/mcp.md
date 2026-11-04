# MCP Servers

OpenABCode connects to [Model Context Protocol](https://modelcontextprotocol.io) servers over stdio or streamable HTTP and makes their tools and resources available to the model.

## Support matrix

| Area | Supported | Not supported |
|---|---|---|
| Protocol versions | `2025-03-26`, `2025-06-18`, `2025-11-25` | `2026-07-28` (stateless protocol) |
| Transports | `stdio`, Streamable HTTP (`http` / `streamable-http`) | Legacy SSE (`sse`) |
| Server capabilities | `tools` (`tools/list`, `tools/call`, `notifications/tools/list_changed`), `resources` (`resources/list`, `resources/templates/list`, `resources/read`), `logging` (`notifications/message`) | `prompts`, `sampling`, `elicitation`, `tasks`, MCP Apps (`ui://` / `profile=mcp-app`) |
| Authentication | Custom headers (`${ENV_VAR}`), OAuth 2.1 with PKCE, dynamic client registration (`dcr`), pre-registered client credentials, token refresh, scope step-up | Automatic forwarding of OpenABCode or model provider credentials (`auth.provider`), `pi.dev` Client ID Metadata Documents |
| Tool exposure | `deferred` (default, loaded on demand via `tool_search`), `direct`, `hidden`, per-tool `toolExposure` | `codemode` |

## Quick setup

This walkthrough connects a filesystem server and uses it in a first session. You need a working [OpenABCode installation and model login](quickstart.md), plus Node.js and `npx` for this example. Other stdio servers may require Python and `uvx` instead.

> **Availability:** This guide describes the built-in MCP integration. If `openabcode mcp help` is not available in your installation, use a release or development build that includes MCP support.

### 1. Add a local server

Run these commands from the project directory you want the server to access:

```bash
cd /path/to/project
openabcode mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem "$PWD"
```

`"$PWD"` supplies an absolute allowed directory, so the server keeps the same scope if you later start OpenABCode elsewhere. Choose a narrow directory rather than your home directory or filesystem root. This example uses a POSIX shell; in PowerShell, replace `"$PWD"` with `(Get-Location).Path`.

The entry is saved to `~/.openabcode/agent/mcp.json`. `npx -y` downloads and runs the server package: review the package before launching it, and pin a reviewed package version for repeatable setups. MCP servers are not sandboxed automatically.

### 2. Verify the connection

```bash
openabcode mcp list
```

Find `filesystem` with a connected state and at least one offered tool. The command starts the server, discovers its capabilities, then closes the connection. It does not require a model request. If it fails, check that Node.js and `npx` are on `PATH` and the allowed directory exists; see [connection troubleshooting](#diagnose-connection-problems).

For machine-readable output:

```bash
openabcode mcp list --json
```

### 3. Use an MCP tool in a session

```bash
openabcode
```

Run `/mcp` to inspect the session's connection and tools, then enter a prompt such as:

```text
Use the filesystem MCP server to list its allowed directories, then list the files in this project. Do not edit or delete anything.
```

By default, tools use `deferred` exposure: the model uses `tool_search` to discover the appropriate MCP tool, then calls it. You do not need to paste tool schemas into the prompt, run `tool_search` in your shell, or use a `/tool_search` command. Successful tool calls appear in the conversation with names such as `mcp__filesystem__list_directory`.

In `/mcp`, select the server to inspect tools, reconnect, change exposure, or enable and disable it. Run `/reload` after adding, removing, or changing configuration outside a running session.

### 4. Share configuration with a project

Use `--local` or `-l` to save the entry to `.openabcode/mcp.json` instead:

```bash
openabcode mcp add --local filesystem -- npx -y @modelcontextprotocol/server-filesystem .
```

Here `.` resolves relative to the session's working directory rather than storing one machine's absolute project path. Review the command before trusting the project. Start `openabcode` in that project and approve project trust, or explicitly inspect it for one shell command:

```bash
openabcode mcp list --approve
```

`--approve` applies only to that command; it does not persist a trust decision. Without trust, project configuration is ignored. Commit only configuration intended for collaborators, never tokens or credentials. A project entry takes precedence over a user-level entry with the same server name.

### 5. Connect a remote server

For an HTTP server with a bearer token, replace the example endpoint and set the token in the same terminal that starts OpenABCode:

```bash
export DOCS_TOKEN='replace-with-your-server-token'
openabcode mcp add docs --url https://example.com/mcp --bearer-token-env-var DOCS_TOKEN
openabcode mcp list
openabcode
```

The configuration stores `Bearer ${DOCS_TOKEN}`, not the token value. The endpoint must support Streamable HTTP; a legacy `/sse` endpoint is not supported. MCP requests go directly from your local CLI to the configured server, not through the OpenABCode hosted gateway.

For an OAuth server, no bearer-token setting is needed:

```bash
openabcode mcp add sentry --url https://mcp.sentry.dev/mcp
openabcode mcp login sentry
openabcode mcp list
```

Approve access in the browser. If it opens on another machine, paste the redirected URL back into the sign-in prompt. See [OAuth setup](#authenticate-with-oauth) for pre-registered clients and callback options. MCP sign-in is separate from OpenABCode `/login`.

### 6. Disable or remove a server

Use `/mcp` to disable a server while keeping its configuration. To remove it permanently:

```bash
openabcode mcp remove filesystem
# Remove a project entry instead:
openabcode mcp remove --local filesystem
```

Use `openabcode --no-mcp` to start one session without built-in MCP integration. Removing configuration does not immediately stop a server in another running session; run `/reload` there.

## Configure servers

OpenABCode reads user-level servers from `~/.openabcode/agent/mcp.json` and project servers from `.openabcode/mcp.json`. Project configuration is read only after [project trust](security.md) is granted. A project entry replaces a user-level entry with the same name.

> **Security note:** Project trust only gates whether `.openabcode/mcp.json` is loaded; it is not an OS sandbox. Local `stdio` MCP servers run as child processes with the operating system permissions of the user running `openabcode`. Only trust projects and MCP servers whose commands you have reviewed.

A project entry without `command`, `url`, or `type` overrides only `enabled`, `exposure`, and `toolExposure` of the user-level server with the same name and keeps the rest, including `env`, `headers`, and `oauth`. For example, this turns off a user-level server in one project:

```json
{
  "mcpServers": {
    "internal-tools": { "enabled": false }
  }
}
```

The format matches other MCP clients:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "docs": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "description": "Search and read the product documentation"
    }
  }
}
```

Stdio servers use `command`, `args`, `env`, and `cwd`. Relative `cwd` values resolve against the session working directory. A leading `~/` in `command`, an argument, or `cwd` names the home directory.

HTTP servers use `url`, `headers`, and `oauth` (see [Authenticate with OAuth](#authenticate-with-oauth)). The legacy SSE transport is not supported; use the server's Streamable HTTP endpoint (typically `/mcp` instead of `/sse`).

Both server types support:

- `timeout`: per-request timeout in seconds (default 60). Progress notifications reset it.
- `enabled: false`: keep the entry without connecting to it.
- `exposure` and `toolExposure`: control how tools reach the model (see [Control tool exposure](#control-tool-exposure)).
- `description`: what the server offers, in a sentence. It lists the server in the system prompt and helps `tool_search` rank the server's tools. Without it, the first line of the server instructions is used once the server connects.

### Configuration rules

- Server names may contain only letters, digits, `_`, and `-`. Tools are named `mcp__<server>__<tool>`, with every character other than letters, digits, and `_` replaced by `_`; tools of a server whose names then collide or exceed 64 characters get a hash suffix. Server names that differ only in `-` and `_` count as the same server: a second one is rejected, and an `mcp.json` server overrides a registered one.
- `type` is optional. A `command` selects stdio and a `url` selects streamable HTTP. When present, `type` must be `stdio`, `http`, or `streamable-http`.
- `sse` is rejected. Servers that document an SSE endpoint often also provide streamable HTTP, commonly at `/mcp` instead of `/sse`.
- `command` is one executable and `args` contains its arguments. It is not a shell command string.
- `env` and `headers` values can reference environment variables such as `${GITHUB_TOKEN}`.
- Invalid entries are reported and skipped without preventing other servers from connecting.

### Inspect or change a server

`/mcp` lists configured servers with their state, tool count, exposure, and configuration source. Servers that need attention appear first. Select a server to inspect its tools and connection details, reconnect, sign in or out, change exposure, or enable and disable it.

Exposure and enabled-state changes are saved atomically to the file that defines the server without replacing unrelated content. In a trusted project, "Enable in this project" and "Disable in this project" add a project override for a user-level server; later changes to that server are saved to the override. Disabled servers remain listed. Outside the interactive TUI, `/mcp` prints server status; `/mcp login <server>`, `/mcp logout <server>`, and `/mcp reconnect <server>` perform those actions directly.

Shell commands work without a session: `openabcode mcp add`, `openabcode mcp remove`, `openabcode mcp list [--json]`, `openabcode mcp login`, and `openabcode mcp logout`. Shell commands do not load extensions. They use the same saved project-trust decision and global `defaultProjectTrust` (`ask`, `always`, or `never`) as sessions. Non-interactive `ask` ignores untrusted project configuration. Use `--approve` to trust it for one command or `--no-approve` to ignore it; neither flag persists a decision. Flags after the stdio separator `--` are server arguments, not OpenABCode trust flags.

### Diagnose connection problems

Run `openabcode mcp list` to connect to every enabled server and print its state, tools, and errors. It exits with status 1 when an entry is invalid or an enabled server is not connected. `/mcp` shows the connection error and the tail of stderr from a failed stdio server. Logs, CLI/TUI diagnostics, and SDK/RPC status redact authorization credentials, configured secrets, and stored access/refresh tokens. Servers can still emit sensitive data in tool results; diagnostics redaction is not a replacement for reviewing server output.

OpenABCode reports configuration errors, failed connections, and required sign-ins once after startup. Server logging notifications are appended to `~/.openabcode/agent/mcp.log` as `<time> [<server>] <level> <logger>: <message>` with Bearer tokens and secret fields redacted. The file rotates to `mcp.log.1` after it grows past 5 MB.

OpenABCode connects every enabled server in the background when a session starts. The first prompt waits up to 10 seconds only for servers with `direct` tools, which must be declared in its request. Servers with `deferred` tools are waited for when `tool_search` or a resource tool needs them. HTTP network errors and transient statuses (408, 429, and 5xx) are retried twice during connection and once for read-only resource requests. Tool calls are not retried automatically on transient HTTP errors because the server may already have executed them. A dropped connection is shown as disconnected and reconnects on the next call. When a server announces a changed tool list (`notifications/tools/list_changed`), new tools are added and withdrawn tools become unreachable. Calls from an older request snapshot recheck tool availability and the current input schema after reconnect, including expired-session retries, before sending `tools/call`.

Stopping a stdio server closes its stdin, sends SIGTERM, then sends SIGKILL to its process group, cleaning up wrapper processes (`npx`, `uvx`) and any child processes holding stdio pipes.

## Migrate configuration from another client

Move the converted entry under `mcpServers` in `mcp.json`, then run `openabcode mcp list` to validate it.

| Client | Conversion |
|---|---|
| Claude Desktop, Claude Code, or Cursor | Copy the existing `mcpServers` entry directly. |
| VS Code | Move an entry from the top-level `servers` object into `mcpServers` and replace `${input:...}` prompts with `${NAME}` environment variables. |
| Codex | Convert `[mcp_servers.<name>]` TOML fields such as `command`, `args`, `env`, and `url` to JSON under `mcpServers`. |
| OpenCode | Convert `"type": "local"` to a stdio entry, split its `command` array into `command` and `args`, rename `environment` to `env`, and replace `{env:NAME}` with `${NAME}`. Convert `"type": "remote"` to a URL entry. |

## Authenticate with OAuth

Remote servers that use OAuth, such as Sentry or Linear, need no credentials in `mcp.json`:

```json
{
  "mcpServers": {
    "sentry": { "url": "https://mcp.sentry.dev/mcp" }
  }
}
```

When the server rejects an unauthenticated connection, `/mcp` shows that it needs sign-in. Select "Sign in", run `/mcp login sentry`, or run `openabcode mcp login sentry`. OpenABCode opens the authorization page and waits for approval. If the browser runs on another machine, such as over SSH, paste its redirected URL into the sign-in screen. A running session picks up the new credentials automatically. Headless print/SDK sessions without a UI and RPC sessions do not open a browser or await terminal input: run `openabcode mcp login <server>` separately. Interactive session sign-in is cancelled by shutdown or after five minutes (SDK factories can override `loginTimeoutMs`).

OpenABCode registers a client with the authorization server (default `client_name`: `openabcode`), stores tokens in `~/.openabcode/agent/mcp-auth.json` with restricted file permissions, and refreshes access tokens under a cross-process lock when they expire or the server rejects them. If a server later requests additional scope (`insufficient_scope`), OpenABCode asks for sign-in again while preserving previously granted scopes. Signing out deletes the stored credentials.

MCP OAuth credentials are completely separate from OpenABCode account and model provider credentials (`auth.json`); OpenABCode never forwards model provider tokens to MCP servers.

Credentials belong to a server name and URL. Servers with the same URL under different names, such as one per account, sign in separately; servers with the same name and URL in different `mcp.json` files share one sign-in.

OAuth applies to HTTP servers without an `Authorization` header. For a server that does not support dynamic client registration, configure a registered client:

```json
{
  "mcpServers": {
    "example": {
      "url": "https://mcp.example.com/mcp",
      "oauth": { "clientId": "my-client", "clientSecret": "${EXAMPLE_SECRET}", "callbackPort": 8765 }
    }
  }
}
```

The redirect URI must match the registered URI. `callbackPort` uses `http://127.0.0.1:<port>/callback`. To use another URI, set `callbackUrl`; it must use HTTP on `localhost`, `127.0.0.1`, or `[::1]` without query or fragment. When `callbackUrl` omits a port, OpenABCode uses `callbackPort` or a free port and adds it to the URI (RFC 8252).

Set `scope` to a space-separated list for servers that do not advertise their required scopes. Set `clientName` when a server only accepts registrations from known client names:

```json
{
  "mcpServers": {
    "figma": { "url": "https://mcp.figma.com/mcp", "oauth": { "clientName": "Claude Code" } }
  }
}
```

Set `authServerMetadataUrl` to an HTTPS metadata document (or HTTP on loopback) if a server advertises the wrong authorization server or none.

## Control tool exposure

Each server tool is registered as `mcp__<server>__<tool>`. The server's `exposure` determines how the model reaches it:

| Exposure | Behavior | Typical use |
|---|---|---|
| `deferred` (default) | Not declared in the initial tool list; loaded on demand when [`tool_search`](#tool-search) matches them for the next model call. | General and large MCP servers, keeping initial context lean. |
| `direct` | Declared to the model immediately like a built-in tool. | Small, frequently used tool sets. |
| `hidden` | Registered but unreachable. Cannot be searched, activated, or called. | Servers or tools that should remain unavailable. |

Servers with `deferred` tools are listed in the `<mcp_servers>` section of the system prompt with a one-line summary from `description` or the server's `instructions` (capped to a 4 KB section budget). OpenABCode automatically activates `tool_search` when an enabled server has `deferred` tools.

`toolExposure` overrides the server exposure for individual tools. Keys are exact server tool names or patterns where `*` matches any characters. Exact names win over patterns; among patterns, the first match wins:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "exposure": "deferred",
      "toolExposure": {
        "search_code": "direct",
        "delete_*": "hidden"
      }
    }
  }
}
```

Tools loaded by `tool_search` are recorded on the session branch and remain declared across resume, fork, `/tree` navigation, and `/reload`.

`--tools` does not remove MCP tools unless one of its entries starts with `mcp__`; `openabcode --tools read,tool_search,'mcp__docs__*'` keeps only the tools of `docs`. `--exclude-tools` accepts the same `*` patterns, `--no-tools` disables all tools including MCP tools, and `--no-mcp` disables built-in MCP integration for one run.

Text results over 20 KB reach the model with their middle removed around a `…N chars truncated…` marker, and the full text is saved to a restricted temporary file (`0600`) named in the result.

### Tool search

`tool_search` searches tools from enabled, non-hidden servers by name and description. A matching tool is loaded into the model's tool list for its next request. Tell the model which server or capability to use, for example:

```text
Find the MCP tool for searching the docs server, then use it to look up authentication examples.
```

Use `direct` for a small set of tools that must be available immediately, or `hidden` to make a server or individual tool unreachable. These settings control discovery and availability, not operating-system permissions or an approval policy.

## Use resources

When a connected server offers [resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources), OpenABCode adds three resource tools:

- `list_mcp_resources`: lists resources as JSON (`{ server?, resources: [{ server, uri, name, ... }], nextCursor? }`). With `server`, it lists one page and `cursor` continues it; without `server`, it lists every resource from every server.
- `list_mcp_resource_templates`: lists RFC 6570 URI templates for parameterized resources.
- `read_mcp_resource`: reads a resource by `server` and `uri`. Text reaches the model as text and images as images; other binary resources are saved to restricted temporary files and the model receives the file path.

For example, ask the model:

```text
List the MCP resources from the docs server, then read the relevant getting-started guide and summarize it.
```

The server must advertise resources; a tool-only server will not gain resource tools simply because it is configured.

These tools reach every enabled, non-hidden server with resources. Their exposure matches the widest exposure among those servers (`direct` if any resource server is `direct`, otherwise `deferred`). Resource links in tool results reference `read_mcp_resource` and the server name. MCP App UI resources (`ui://` URIs or `text/html;profile=mcp-app`) are omitted.

## Permissions

Every MCP tool and resource call passes through OpenABCode's tool pipeline. Extension `tool_call` and `tool_result` handlers, including permission gates, apply to MCP tools the same way they apply to built-in tools.

`openabcode.getAllTools()` reports the boolean annotations declared by each server: `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. Server annotations are untrusted hints and do not bypass local permission policies.

## Extensions and SDK

### Add servers from extensions

Extensions can register servers for the current session with `openabcode.registerMcpServer(name, config)`:

```typescript
export default function (openabcode: ExtensionAPI) {
  openabcode.registerMcpServer("jira", {
    url: "https://mcp.example.com/jira",
    exposure: "deferred",
  });
}
```

Registered servers connect alongside `mcp.json` servers and appear in `/mcp` with the extension as their source. A file-configured server with the same name takes precedence.

### Replace the built-in MCP support

An installed extension that registers `/mcp` replaces the built-in MCP extension for sessions instead of conflicting or connecting twice. Pass `--no-mcp` to disable built-in MCP support for one CLI run.

### Use MCP from the SDK

SDK sessions do not load built-in extensions automatically. Pass `createMcpExtension()` and `createToolSearchExtension()` in `extensionFactories` on `DefaultResourceLoader`:

```typescript
import {
  createAgentSession,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  getAgentDir,
} from "@openabcode/coding-agent";

const cwd = process.cwd();
const agentDir = getAgentDir();
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  extensionFactories: [createToolSearchExtension(), createMcpExtension({ agentDir })],
});
await resourceLoader.reload();

const { session } = await createAgentSession({ cwd, agentDir, resourceLoader });
session.subscribe((event) => {
  if (event.type === "mcp_status_change") {
    // event.servers, event.errors, event.overridden are credential-free snapshots.
  }
});
try {
  // Required: creation loads factories; binding emits session_start and starts connections.
  await session.bindExtensions({});
  await session.prompt("Find the relevant MCP tool and use it.");
} finally {
  await session.dispose(); // Wait for shutdown handlers and transport/process cleanup.
}
```

`session.getMcpStatus()` returns `{ servers, errors, overridden }` for both file-configured and extension-registered servers. Each server includes source/scope, connection state, sanitized transport/error, exposure, tools, and resource capability. `openabcode.getMcpStatus()` exposes the same snapshot to extensions; `getMcpServers()` only lists extension registrations, not runtime state. The `mcp_status_change` session event reports snapshot changes without polling.

`await session.reload()` shuts down the old extension runtime, reloads factories, and starts the new connections even for headless bindings. Disposal is asynchronous and idempotent. For session replacement through `AgentSessionRuntime`, bind extensions on the new session as described in [SDK lifecycle](sdk.md).

RPC clients use `{"type":"get_mcp_status"}` and receive the same snapshot as `openabcode mcp list --json` (without the shell's timestamp), plus streamed `mcp_status_change` events. The typed `RpcClient` provides `getMcpStatus()`. See [RPC state](rpc.md#get_mcp_status).
