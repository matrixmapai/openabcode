> openabcode can help you create openabcode packages. Ask it to bundle your extensions, skills, prompt templates, or themes.

# OpenABCode Packages

OpenABCode packages bundle extensions, skills, prompt templates, and themes so you can share them through npm or git. A package can declare resources in `package.json` under the `openabcode` key, or use conventional directories.

## Table of Contents

- [Install and Manage](#install-and-manage)
- [Package Sources](#package-sources)
- [Creating a OpenABCode Package](#creating-a-openabcode-package)
- [Package Structure](#package-structure)
- [Dependencies](#dependencies)
- [Package Filtering](#package-filtering)
- [Enable and Disable Resources](#enable-and-disable-resources)
- [Scope and Deduplication](#scope-and-deduplication)

## Install and Manage

> **Security:** OpenABCode packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

```bash
openabcode install npm:@foo/bar@1.0.0
openabcode install git:github.com/user/repo@v1
openabcode install https://github.com/user/repo  # raw URLs work too
openabcode install /absolute/path/to/package
openabcode install ./relative/path/to/package

openabcode remove npm:@foo/bar
openabcode list                     # show installed packages from settings
openabcode update                   # update openabcode only
openabcode update --all             # update openabcode, update packages, and reconcile pinned git refs
openabcode update --extensions      # update packages and reconcile pinned git refs only
openabcode update --self            # update openabcode only
openabcode update --self --force    # reinstall openabcode even if current
openabcode update npm:@foo/bar      # update one package
openabcode update --extension npm:@foo/bar
```

These commands manage openabcode packages and `openabcode update` can update the openabcode CLI installation. To uninstall openabcode itself, see [Quickstart](quickstart.md#uninstall).

By default, `install` and `remove` write to user settings (`~/.openabcode/agent/settings.json`). Use `-l` to write to project settings (`.openabcode/settings.json`) instead. Project settings can be shared with your team, and openabcode installs any missing packages automatically on startup after the project is trusted.

To try a package without installing it, use `--extension` or `-e`. This installs to a temporary directory for the current run only:

```bash
openabcode -e npm:@foo/bar
openabcode -e git:github.com/user/repo
```

## Package Sources

OpenABCode accepts three source types in settings and `openabcode install`.

### npm

```
npm:@scope/pkg@1.2.3
npm:pkg
```

- Versioned specs are pinned and skipped by package updates (`openabcode update --extensions`, `openabcode update --all`).
- User installs go under `~/.openabcode/agent/npm/`.
- Project installs go under `.openabcode/npm/`.
- Set `npmCommand` in `settings.json` to pin npm package lookup and install operations to a specific wrapper command such as `mise` or `asdf`.

Example:

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

### git

```
git:github.com/user/repo@v1
git:git@github.com:user/repo@v1
https://github.com/user/repo@v1
ssh://git@github.com/user/repo@v1
```

- Without `git:` prefix, only protocol URLs are accepted (`https://`, `http://`, `ssh://`, `git://`).
- With `git:` prefix, shorthand formats are accepted, including `github.com/user/repo` and `git@github.com:user/repo`.
- HTTPS and SSH URLs are both supported.
- SSH URLs use your configured SSH keys automatically (respects `~/.ssh/config`).
- For non-interactive runs (for example CI), you can set `GIT_TERMINAL_PROMPT=0` to disable credential prompts and set `GIT_SSH_COMMAND` (for example `ssh -o BatchMode=yes -o ConnectTimeout=5`) to fail fast.
- Refs are pinned tags or commits. `openabcode update --extensions` and `openabcode update --all` do not move them to newer refs, but they do reconcile an existing clone to the configured ref.
- Use `openabcode install git:host/user/repo@new-ref` to update settings and move an existing package to a new pinned ref.
- Cloned to `~/.openabcode/agent/git/<host>/<path>` (global) or `.openabcode/git/<host>/<path>` (project).
- When reconciliation changes the checkout, openabcode resets and cleans the clone, then runs `npm install` if `package.json` exists.

**SSH examples:**
```bash
# git@host:path shorthand (requires git: prefix)
openabcode install git:git@github.com:user/repo

# ssh:// protocol format
openabcode install ssh://git@github.com/user/repo

# With version ref
openabcode install git:git@github.com:user/repo@v1.0.0
```

### Local Paths

```
/absolute/path/to/package
./relative/path/to/package
```

Local paths point to files or directories on disk and are added to settings without copying. Relative paths are resolved against the settings file they appear in. If the path is a file, it loads as a single extension. If it is a directory, openabcode loads resources using package rules.

## Creating a OpenABCode Package

Add a `openabcode` manifest to `package.json` or use conventional directories. Include the `openabcode-package` keyword for discoverability.

```json
{
  "name": "my-package",
  "keywords": ["openabcode-package"],
  "openabcode": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Paths are relative to the package root. Arrays support glob patterns and `!exclusions`.

### Gallery Metadata

The [package gallery](https://openabcode.com/packages) displays packages tagged with `pi-package`. Add `video` or `image` fields to show a preview:

```json
{
  "name": "my-package",
  "keywords": ["openabcode-package"],
  "openabcode": {
    "extensions": ["./extensions"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

- **video**: MP4 only. On desktop, autoplays on hover. Clicking opens a fullscreen player.
- **image**: PNG, JPEG, GIF, or WebP. Displayed as a static preview.

If both are set, video takes precedence.

## Package Structure

### Convention Directories

If no `openabcode` manifest is present, openabcode auto-discovers resources from these directories:

- `extensions/` loads `.ts` and `.js` files
- `skills/` recursively finds `SKILL.md` folders and loads top-level `.md` files as skills
- `prompts/` loads `.md` files
- `themes/` loads `.json` files

## Dependencies

Third party runtime dependencies belong in `dependencies` in `package.json`. Dependencies that do not register extensions, skills, prompt templates, or themes also belong in `dependencies`. When openabcode installs a package from npm or git, it runs `npm install`, so those dependencies are installed automatically.

OpenABCode bundles core packages for extensions and skills. If you import any of these, list them in `peerDependencies` with a `"*"` range and do not bundle them: `@openabcode/ai`, `@openabcode/agent-core`, `@openabcode/coding-agent`, `@openabcode/tui`, `typebox`.

Other openabcode packages must be bundled in your tarball. Add them to `dependencies` and `bundledDependencies`, then reference their resources through `node_modules/` paths. OpenABCode loads packages with separate module roots, so separate installs do not collide or share modules.

Example:

```json
{
  "dependencies": {
    "shitty-extensions": "^1.0.1"
  },
  "bundledDependencies": ["shitty-extensions"],
  "openabcode": {
    "extensions": ["extensions", "node_modules/shitty-extensions/extensions"],
    "skills": ["skills", "node_modules/shitty-extensions/skills"]
  }
}
```

## Package Filtering

Filter what a package loads using the object form in settings:

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

`+path` and `-path` are exact paths relative to the package root.

- Omit a key to load all of that type.
- Use `[]` to load none of that type.
- `!pattern` excludes matches.
- `+path` force-includes an exact path.
- `-path` force-excludes an exact path.
- Filters layer on top of the manifest. They narrow down what is already allowed.

## Enable and Disable Resources

Use `openabcode config` to enable or disable extensions, skills, prompt templates, and themes from installed packages and local directories. `openabcode config` starts in global settings (`~/.openabcode/agent/settings.json`); press Tab to switch between global and project-local modes. Use `openabcode config -l` to start in project overrides (`.openabcode/settings.json`) with inherited global resources dimmed.

## Scope and Deduplication

Packages can appear in both global and project settings. If the same package appears in both, the project entry wins unless the project entry has `autoload: false`, in which case it is applied as a delta over the global entry. Identity is determined by:

- npm: package name
- git: repository URL without ref
- local: resolved absolute path
