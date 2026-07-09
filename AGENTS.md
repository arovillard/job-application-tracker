# Job Application Workflow

When the user says "help me apply to this job" and provides a job link:

1. Use the packaged `job-tracker-add-posting` skill to add or update the job in the local tracker.
2. Verify the tracker script output before creating application materials.
3. Use the packaged `job-application-resume` skill before doing application-materials work.
4. Do not create duplicate tracker records for the same company and role; update the existing record and add a note explaining source/status changes.
5. If sources disagree about whether a posting is open, keep the tracker record active unless the user confirms it should be archived.
6. Do not submit applications or use credentials on the user's behalf.

# New User Setup Workflow

When setting up this project for a new user or new machine:

1. Read `README.md` and `docs/agent-setup.md`.
2. Collect the user's project location, application-materials directory, base resume path, public profile URL, whether they use Codex, Claude Code, or both, and whether their AI provider is configured in the host agent.
3. Do not collect API keys or secrets in this repository; use the host agent's secure provider setup flow when needed.
4. For agent-owned installs, check `git`, `node`, and `npm`; install missing prerequisites with the system package manager or ask before using administrator privileges.
5. Run `npm install`, `npm run setup`, `npm run skills:install`, `npm run verify`, and `npm run build`.
6. Start the app with `npm run dev`, give the local URL, and tell the user setup is ready for the first job posting link.
7. Confirm `.env.local`, `data/*.sqlite`, resumes, and generated `applications/*` content remain private and uncommitted.
