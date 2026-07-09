# Changelog

## 0.1.4

- Link generated application-material files to application records without duplicating Markdown content in SQLite.
- Display linked Markdown materials on the application detail page.
- Add a CLI for agents to register generated files with tracker records.

## 0.1.3

- Add a copy/paste agent-managed setup prompt to the README.
- Document the end-to-end install contract for Codex and Claude setup agents.

## 0.1.2

- Add Claude Code project skills under `.claude/skills`.
- Install both Codex and Claude personal skills with `npm run skills:install`.
- Add provider-specific skill install commands and tests.

## 0.1.1

- Replace the Python job posting upsert helper with a Node.js CLI.
- Remove Python from the new-user setup requirements.
- Keep skill automation on the same Node/npm dependency path as the app.

## 0.1.0

- Initial GitHub-ready release.
- Local Next.js and SQLite job application tracker.
- Packaged Codex skills for job posting intake and application-materials drafting.
- New-user setup script and GitHub release workflow.
