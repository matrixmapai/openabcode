<p align="center">
  <strong>OpenABCode</strong>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@openabcode/coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@openabcode/coding-agent?style=flat-square" /></a>
</p>

# OpenABCode

OpenABCode is a terminal coding agent with automatic task routing. Route classifies each prompt, selects the configured OpenAI, Google, or Anthropic model for the task, and then runs the same agent and tool loop with the selected model.

Use your own provider credentials or sign in to the OpenABCode hosted gateway. The CLI also supports fixed-model operation, custom providers, extensions, skills, prompt templates, and themes.

To learn more about OpenABCode:

* [Visit openabcode.com](https://openabcode.com), the project website
* [Read the documentation](https://openabcode.com/docs)

## Quick Start

Requires Node.js 22.19 or newer.

```bash
npm install -g --ignore-scripts @openabcode/coding-agent
openabcode
```

Inside the interactive CLI:

```text
/login         Sign in to OpenABCode or another provider
/model         Select fixed models and Route family models
/route-model   Select the model that classifies Route tasks
/route         Turn automatic task routing on or off
```

When Route is on, the footer shows the configured execution models. Every completed routing decision is also stored in the session JSONL for audit.

## Architecture

```text
User prompt
  -> @openabcode/coding-agent  Route configuration and model selection
  -> @openabcode/ai            Classifier and provider API requests
  -> @openabcode/agent-core    Agent loop, state, and tool execution
```

## All Packages

| Package | Description |
|---------|-------------|
| **[@openabcode/ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@openabcode/agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@openabcode/coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@openabcode/tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@openabcode/orchestrator](packages/orchestrator)** | Experimental multi-agent orchestration package |

## Permissions & Containerization

OpenABCode does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox OpenABCode. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `openabcode` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `openabcode` process in a local container for simple isolation.
- **OpenShell**: run the whole `openabcode` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./openabcode-test.sh         # Run openabcode from sources (can be run from any directory)
```

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `OPENABCODE_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `openabcode update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## License

MIT

Portions derived from [Pi](https://github.com/earendil-works/pi) (MIT). See [NOTICE](NOTICE) for attribution.
