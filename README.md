# Opportunity Tracker

Local-first opportunity tracker for job applications and professional connections, built with Next.js and SQLite. The repository also includes Codex and Claude skills that let an AI agent add public job postings and prepare job-specific application materials.

## What A New User Needs

Required:

- Node.js and npm.
- A local folder for this project.
- A base resume source if they want AI-tailored resumes or fit analyses. A private Google Doc connected to the agent is preferred; DOCX is the best file fallback, and PDF is supported with less reliable formatting.
- Codex or Claude Code, with the user's AI provider configured outside this repo.

Optional:

- A custom application-materials folder. The default is `./applications` inside the repository.
- A custom SQLite database path. The default is `data/jobtracker.sqlite`.
- A public profile URL, usually LinkedIn. It improves context but is not required.

This repo does not store API keys, provider credentials, private resumes, generated application dossiers, or the user's live SQLite database.

## Starting A Fresh Agent Session

Open this repository in Codex or Claude Code and say:

```text
help me apply
```

That is the primary application entrypoint. Repository instructions—not prior chat memory—tell a fresh session to check your workspace before handling a job link. The agent asks only for missing or invalid details, then says:

> Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you're ready.

A private Google Doc connected through the agent is the preferred master resume. The agent reads it through your signed-in Google connection, never asks you to make it public, and creates a role-specific copy instead of editing the master. DOCX is the preferred local fallback. PDF also works, but matching its formatting consistently can be difficult.

To save the resume and profile references without running a terminal command, give the agent both values in one message:

```text
Configure my reusable application profile for this project.
Master resume Google Doc: https://docs.google.com/document/d/EXAMPLE_DOCUMENT_ID/edit
LinkedIn profile: https://www.linkedin.com/in/example
Save these in the project's private local configuration, verify readiness, and tell me when I am ready to provide a job link.
```

Replace the example links with your own. For a local resume, use `Master resume file:` followed by its full path. The agent saves the resume under `JOBTRACKER_BASE_RESUME_URL` or `JOBTRACKER_BASE_RESUME_PATH` and the profile under `JOBTRACKER_LINKEDIN_URL` in the ignored `.env.local` file. It saves every supplied value together and leaves settings you did not mention unchanged.

A local fresh session reuses the ignored `.env.local` and local files, then validates them again. For Codex Cloud, configure the same setting names as cloud environment variables because a cloud checkout does not receive the private `.env.local` file. Saving the Google Docs URL remembers which document to use but does not replace Google Drive authorization, so Google access may still need to be reconnected in a new host session.

## Quick Start

```bash
npm install
npm run setup
npm run dev
```

Open the local URL printed by Next.js. By default the app uses `data/jobtracker.sqlite` and stores generated materials in `./applications`; both are created automatically when needed.

For a non-interactive default setup:

```bash
npm run setup -- --yes
```

## Agent-Managed Setup

For the easiest setup, paste this prompt into Codex or Claude Code. Replace any bracketed values you already know, and let the agent ask for the rest.

```text
Please set up Opportunity Tracker for me end to end.

Repository: https://github.com/arovillard/job-application-tracker
Preferred project folder: [tell the agent where to clone it, or ask me]
Optional application materials override: [leave blank to use ./applications, or provide a custom relative or absolute path]
AI agent: [Codex, Claude Code, or both]

Do the following in order:

1. Check whether this computer has git, Node.js, and npm installed.
2. If a required dependency is missing, install it with the appropriate system package manager or ask me before using administrator privileges.
3. Clone the repository into the project folder, or update the existing local copy if it is already there.
4. Install project dependencies with npm install.
5. Ask me for the information the app needs:
   - Do not ask for an application-materials folder unless I requested an override; otherwise keep the ./applications default.
   - My private Google Docs resume URL first. If I do not use Google Docs, ask for a DOCX or PDF path instead.
   - My public LinkedIn profile URL or other public profile URL, if I want to provide one.
   - Whether my AI provider is already configured in this agent.
6. Do not ask me to paste API keys or secrets into this repository. Use this agent's secure provider setup flow if credentials are needed.
7. Run npm run setup and provide the answers I gave you, or write .env.local from .env.example using those values.
8. Run npm run skills:install so the packaged Codex and Claude skills are installed.
9. Run npm run verify and npm run build. Fix any setup issue that prevents them from passing.
10. Start the app with npm run dev and tell me the local URL.
11. Confirm that .env.local, the SQLite database, my resume, and generated application materials are private and not committed to Git.
12. Finish by telling me setup is complete. For application work, I will open the repository and say "help me apply"; validate readiness before asking for or processing a job link.
```

## Configuration

`npm run setup` writes `.env.local`. You can also copy `.env.example` to `.env.local` and edit it manually.

Important settings:

- `JOBTRACKER_DB_PATH`: SQLite file used by the app and tracker skill.
- `JOBTRACKER_APPLICATIONS_DIR`: where generated resumes, fit analyses, outreach drafts, and posting PDFs should go. Missing or blank values use `./applications`.
- `JOBTRACKER_BASE_RESUME_URL`: preferred private Google Docs master resume URL. Access stays in the connected host agent.
- `JOBTRACKER_BASE_RESUME_PATH`: optional reference resume for AI-generated materials.
- `JOBTRACKER_LINKEDIN_URL`: optional public profile URL for AI context.
- `JOBTRACKER_AI_PROVIDER`: optional human-readable note; configure credentials through the AI tool, not this file.

Application-materials paths can use the repository-local default, a custom relative folder, or a custom absolute folder:

```dotenv
JOBTRACKER_APPLICATIONS_DIR="./applications"
JOBTRACKER_APPLICATIONS_DIR="./private-output"
JOBTRACKER_APPLICATIONS_DIR="<user-home>/Documents/job-application-materials"
```

Relative values are relative to the repository and remain portable when the repository moves. Absolute values are useful when materials must live elsewhere. `/applications` is a root-level path, not another spelling of `applications`; do not use it for the repository-local default.

A custom relative folder must already be ignored by Git before setup runs. Add an exact repository-root rule such as `/private-output/` to `.gitignore` or the local `.git/info/exclude`, then rerun setup, or choose an external absolute path. Setup validates this prerequisite but does not modify either ignore file. The default `./applications` continues to work because `applications/*` is already ignored by this repository.

### Changing The Folder After Setup

For an existing install, keep the database and files synchronized when changing the application-materials folder:

1. Stop the running development server.
2. Before moving anything, verify that the destination company folders and files do not already exist. If any collision exists, abort and report it; do not merge, replace, or overwrite files.
3. Move the existing application-materials contents into the new folder.
4. Safely update `JOBTRACKER_APPLICATIONS_DIR` in `.env.local`, or preserve unrelated settings and comments with:

   ```bash
   printf '%s\n' '{"applicationsDirectory":"/absolute/new/path"}' |
     npm run application:configure -- --input-json -
   ```

5. Register the moved files and remove broken local links:

   ```bash
   npm run artifacts:backfill
   ```

6. Restart the app with `npm run dev`.

`npm run artifacts:backfill` loads `.env.local`, including the configured database and application-materials paths. Use `npm run artifacts:backfill -- --applications-dir "/absolute/new/path"` only when an explicit one-off applications-directory override is needed. The backfill registers recognized files from the new location and removes visible artifact links whose local files no longer exist. It is safe to rerun.

## Opportunities

The workspace tracks two opportunity types:

- **Jobs** retain the existing wishlist, applied, interviewing, offer, rejected, and archived pipeline.
- **Connections** track a person from first capture through outreach, conversation, a concrete opportunity, dormancy, closure, or archive. Relationship strength is recorded separately as new, familiar, or strong.

Both types share priority, chronological activity history, actionable tasks, search, and the attention queue. Tasks can be completed, cancelled, reopened, and rescheduled. Detail pages support editing, archiving, confirmed permanent deletion, backdated interactions, and independent task creation. Recording a meeting, call, email, message, introduction, or note can create the next task in the same operation.

A connection can originate multiple linked job opportunities. The connection and each job retain independent histories and link back to each other.

Existing databases migrate automatically and transactionally. Application IDs, timestamps, statuses, notes, status history, follow-ups, next actions, and artifact links are preserved. Typed follow-up notes remain historical note activities; their open tasks, and legacy next-action tasks, are not created for rejected or archived jobs. Legacy `/applications/<id>` links redirect to the migrated opportunity.

## Application Materials

Generated resumes, fit analyses, and outreach drafts should stay as files in `JOBTRACKER_APPLICATIONS_DIR`. The tracker links those material types to a job opportunity and displays them on its detail page. Markdown files are rendered as Markdown, and resume PDFs are shown with an inline PDF viewer. The file remains the source of truth; SQLite stores only the file path and metadata. Connection opportunities cannot own application artifacts.

When the agent creates a tailored Google Doc, it also saves a local PDF or DOCX snapshot in the company application folder and registers that local snapshot with the tracker. The Google Docs link is returned separately; the configured master remains unchanged.

For existing installs with files already in the application-materials folder, run a one-time backfill after pulling the update:

```bash
npm run artifacts:backfill
```

The backfill loads `JOBTRACKER_DB_PATH` and `JOBTRACKER_APPLICATIONS_DIR` from `.env.local`, falling back to `data/jobtracker.sqlite` and `./applications`. Explicit `--db` and `--applications-dir` arguments override that configuration. It matches first-level folders to company names in the tracker and links recognized fit analyses, outreach messages, and resumes. It is safe to rerun; existing links are updated rather than duplicated, and visible artifact links to missing local files are removed.

## Agent Skills

The skills are packaged for both supported agents:

- Codex source skills live in `skills/`.
- Claude Code project skills live in `.claude/skills/`.

- `job-tracker-add-posting`: extracts public posting facts, creates or updates a job opportunity, avoids duplicate organization+role records, and records update activities.
- `job-application-workflow`: checks readiness, gathers only missing setup details, and coordinates tracker intake before application materials.
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
