# Security Policy

This document should guide you about understanding the security concept behind
OpenABCode and also where the boundaries are.

In general OpenABCode is a coding agent that runs locally within the security boundary
of the user that is running it.  It's the responsibiltiy of the user to monitor
its operations or to contain it within a container, virtual machine or other
Sandbox solution.

OpenABCode treats the local user account and files writable by that account as inside
the same trust boundary as the OpenABCode process itself.  If an attacker can modify files
under the user's home directory, workspace, shell startup files, environment, or
OpenABCode configuration, they can generally influence OpenABCode or other local developer tools.
Reports that depend on such prior local write access are not security
vulnerabilities unless they demonstrate how OpenABCode grants that write access or crosses
an operating-system privilege boundary.

OpenABCode relies on users installing trustworthy extensions and loading trustworthy
skills and only to use openabcode within trusted repositories.  This is because files
like `AGENTS.md` or instructions in comments can be used to prompt inject the
coding agent trivially and this cannot be protected against.

## Reporting a Vulnerability

If you believe you found a security vulnerability in openabcode or another package in
this repository, please report it privately by either:

- Emailing `service@openabcode.com`, or
- Opening a private report through GitHub Security Advisories for this repository

Please include:

- A description of the issue and its impact
- Steps to reproduce, proof of concept, or relevant logs
- Affected package, version, commit, or configuration
- Any known mitigations

Do not open a public issue for security-sensitive reports.  We will review
reports and coordinate disclosure as appropriate.

## Scope

Security issues in the distributed packages, command-line tools, APIs, and
repository code are in scope as well as openabcode operated infrastricture
on `openabcode.com`.

## Out Of Scope

- Local code execution or sandboxing behavior (the OpenABCode coding agent intentionally does not have a sandbox)
- Behavior of openabcode extensions or skills installed by the user
- Risks from working in untrusted repositories
- Risks from installing untrusted extensions, skills, packages, or tools
- Isuses caused by non trustworthy MITM proxies
- Public internet exposure of a OpenABCode installation
- Prompt injection attacks
- Exposed secrets that are third-party/user-controlled credentials
- Reports requiring the ability to create, modify, delete, or replace files,
  directories, symlinks, environment variables, shell configuration, or other
  user-controlled local state on the target machine. This includes `~/.openabcode`,
  `~/.openabcode/agent/models.json`, workspace files, `AGENTS.md`, skills, extensions,
  extension configuration, dotfiles, and files synchronized through NFS, roaming
  profiles, or dotfile managers, unless the report shows how OpenABCode itself grants
  that access.
- Issues caused by intentionally weakened user configuration.
- Resource/DOS claims that require trusted local input/config against the openabcode coding agent.
- Reports about malicious model output.
- User-approved or user-initiated local actions presented as vulnerabilities.

## Notes for Reporters

The most useful reports show a current, reproducible security boundary bypass
with demonstrated impact.  Reports that only show expected local-agent behavior,
prompt injection, or a malicious trusted extension/skill are not security
vulnerabilities under this model.

For example, a report showing that malicious contents written to a trusted OpenABCode
configuration file cause OpenABCode to execute commands, load attacker-controlled tools,
send credentials to an attacker-controlled endpoint, or otherwise change behavior
is out of scope.

When possible, include the exact affected path, package version or commit SHA,
configuration, and a proof of concept against the latest release or latest
`main`.  For dependency reports, include evidence that the shipped dependency is
affected and that the issue is reachable through OpenABCode.  For exposed-secret reports,
include evidence that the credential is owned by OpenABCode or grants access to
OpenABCode-operated infrastructure or services.
