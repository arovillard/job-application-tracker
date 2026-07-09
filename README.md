# Job Application Tracker

Local-first job application tracker built with Next.js and SQLite. The repository also includes two Codex skills that let an AI agent add public job postings to the tracker and prepare job-specific application materials.

## What A New User Needs

Required:

- Node.js and npm.
- A local folder for this project.
- A local folder for generated application materials.
- A base resume file if they want AI-tailored resumes or fit analyses.
- A public profile URL, usually LinkedIn, if they want the AI agent to use profile context.
- An AI agent that supports Codex-style skills, with the user's AI provider configured outside this repo.

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

## Configuration

`npm run setup` writes `.env.local`. You can also copy `.env.example` to `.env.local` and edit it manually.

Important settings:

- `JOBTRACKER_DB_PATH`: SQLite file used by the app and tracker skill.
- `JOBTRACKER_APPLICATIONS_DIR`: where generated resumes, fit analyses, outreach drafts, and posting PDFs should go.
- `JOBTRACKER_BASE_RESUME_PATH`: optional reference resume for AI-generated materials.
- `JOBTRACKER_LINKEDIN_URL`: optional public profile URL for AI context.
- `JOBTRACKER_AI_PROVIDER`: optional human-readable note; configure credentials through the AI tool, not this file.

## Codex Skills

The skills are packaged in `skills/`:

- `job-tracker-add-posting`: extracts public posting facts, creates or updates a tracker record, avoids duplicate company+role records, and records update notes.
- `job-application-resume`: creates tailored application materials and a candid fit analysis from verified user source material.

Install or refresh them with:

```bash
npm run skills:install
```

This copies the bundled skill folders to `${CODEX_HOME:-$HOME/.codex}/skills`.

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
- `skills/` stores the distributable skill source.

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
