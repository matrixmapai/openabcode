# Contributing to openabcode

This guide exists to save both sides time.

## Philosophy

First things first: **openabcode's core is minimal**.

If your feature does not belong in the core, it should be an extension. PRs that bloat the core will likely be rejected.

OpenABCode's core exists to be minimal and to be extensible so that it can be influenced and manipulated by extensions.  Even hook points for extensions however should be well considered and discussed to avoid adding unmaintainable bloat and complex interactions.

## The One Rule

**You must understand your code.** If you cannot explain what your changes do and how they interact with the rest of the system, your PR will be closed.

Using AI to write code is fine. Submitting AI-generated slop without understanding it is not.

If you use an agent, run it from the `openabcode` root directory so it picks up `AGENTS.md` automatically. Your agent must follow the rules and guidelines in that file.

## Contributions

Issues and PRs are welcome from all contributors. Please follow the quality bar below.

## Quality Bar For Issues

If you open an issue, keep it short, concrete, and worth reading.

- Keep it concise. If it does not fit on one screen, it is too long.
- Write in your own voice (do not use an LLM to generate text; if you must, follow up with a clearly AI-labeled comment).
- State the bug or request clearly.
- Explain why it matters.
- If you want to implement the change yourself, say so.

## Before Submitting a PR

Before submitting a PR:

```bash
npm run check
./test.sh
```

Both must pass.

Do not edit `CHANGELOG.md`. Changelog entries are added by maintainers.

If you are adding a new provider to `packages/ai`, see `AGENTS.md` for required tests.

## Questions?

Open an issue or start a discussion.
