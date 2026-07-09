# Job Application Tracker

Local-first job application tracker built with Next.js and SQLite. The repository also includes Codex and Claude skills that let an AI agent add public job postings to the tracker and prepare job-specific application materials.

## What A New User Needs

Required:

- Node.js and npm.
- A local folder for this project.
- A local folder for generated application materials.
- A base resume file if they want AI-tailored resumes or fit analyses.
- A public profile URL, usually LinkedIn, if they want the AI agent to use profile context.
- Codex or Claude Code, with the user's AI provider configured outside this repo.

Optional:

- A custom SQLite database path. The default is `data/jobtracker.sqlite`.
- Google Docs or Drive access if the user wants application materials delivered there.

This repo does not store API keys, provider credentials, private resumes, generated application dossiers, or the user's live SQLite database.

## Quick Start

```bash
npm install
npm run setup
npm run dev
```

Open the local URL printed by Next.js. By default the app uses `data/jobtracker.sqlite`; the file is created automatically.

For a non-interactive default setup:

```bash
npm run setup -- --yes
```

## Agent-Managed Setup

For the easiest setup, paste this prompt into Codex or Claude Code. Replace any bracketed values you already know, and let the agent ask for the rest.

```text
Please set up Job Application Tracker for me end to end.

Repository: https://github.com/arovillard/job-application-tracker
Preferred project folder: [tell the agent where to clone it, or ask me]
Preferred application materials folder: [tell the agent where generated resumes, analyses, and outreach drafts should go, or ask me]
AI agent: [Codex, Claude Code, or both]

Do the following in order:

1. Check whether this computer has git, Node.js, and npm installed.
2. If a required dependency is missing, install it with the appropriate system package manager or ask me before using administrator privileges.
3. Clone the repository into the project folder, or update the existing local copy if it is already there.
4. Install project dependencies with npm install.
5. Ask me for the information the app needs:
   - The folder where generated application materials should be stored.
   - My latest resume file. If I upload it in this chat, save it locally and use that path; otherwise ask me for the file path.
   - My public LinkedIn profile URL or other public profile URL.
   - Whether my AI provider is already configured in this agent.
6. Do not ask me to paste API keys or secrets into this repository. Use this agent's secure provider setup flow if credentials are needed.
7. Run npm run setup and provide the answers I gave you, or write .env.local from .env.example using those values.
8. Run npm run skills:install so the packaged Codex and Claude skills are installed.
9. Run npm run verify and npm run build. Fix any setup issue that prevents them from passing.
10. Start the app with npm run dev and tell me the local URL.
11. Confirm that .env.local, the SQLite database, my resume, and generated application materials are private and not committed to Git.
12. Finish by telling me setup is complete and that you are ready for the first job posting link. When I provide a job link, create or update the tracker record first, then prepare the application materials, fit analysis, and outreach/referral drafts.
```

## Configuration

`npm run setup` writes `.env.local`. You can also copy `.env.example` to `.env.local` and edit it manually.

Important settings:

- `JOBTRACKER_DB_PATH`: SQLite file used by the app and tracker skill.
- `JOBTRACKER_APPLICATIONS_DIR`: where generated resumes, fit analyses, outreach drafts, and posting PDFs should go.
- `JOBTRACKER_BASE_RESUME_PATH`: optional reference resume for AI-generated materials.
- `JOBTRACKER_LINKEDIN_URL`: optional public profile URL for AI context.
- `JOBTRACKER_AI_PROVIDER`: optional human-readable note; configure credentials through the AI tool, not this file.

## Agent Skills

The skills are packaged for both supported agents:

- Codex source skills live in `skills/`.
- Claude Code project skills live in `.claude/skills/`.

- `job-tracker-add-posting`: extracts public posting facts, creates or updates a tracker record, avoids duplicate company+role records, and records update notes.
- `job-application-resume`: creates tailored application materials and a candid fit analysis from verified user source material.

Install or refresh them with:

```bash
npm run skills:install
```

This copies the bundled skill folders to both `${CODEX_HOME:-$HOME/.codex}/skills` and `${CLAUDE_HOME:-$HOME/.claude}/skills`.

Provider-specific installs are also available:

```bash
npm run skills:install:codex
npm run skills:install:claude
```

## Development

```bash
npm run lint
npm run typecheck
npm run test
npm run verify
npm run build
```

Useful local state:

- `data/` stores the local SQLite database.
- `applications/` stores generated personal application materials.
- `skills/` stores the distributable Codex skill source.
- `.claude/skills/` stores the distributable Claude Code project skills.

`data/*.sqlite`, `.env.local`, and `applications/*` are ignored so private user state is not published.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

Noncommercial use, copying, modification, and distribution are allowed under that license. Commercial use is not allowed without separate written permission from the copyright holder. Because of that commercial restriction, this is source-available software rather than OSI-approved open source.

## GitHub Releases

CI runs on pushes to `main` and pull requests. Tagged releases use `.github/workflows/release.yml`.

To create a release after the repository is pushed to GitHub:

```bash
npm run verify
npm run build
git tag v<version>
git push origin v<version>
```

See `docs/release-checklist.md` for the full publishing checklist.

## Before Publishing

- Do not commit `.env.local`, `data/*.sqlite`, generated application materials, resumes, or profile exports.
- Initialize Git and review `git status` before pushing. Do not drag-and-drop the whole folder into GitHub while local ignored files are still present.
- Run `npm run verify` and `npm run build`.
