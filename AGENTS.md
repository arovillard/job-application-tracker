# Job Application Workflow

When the user expresses application intent—with or without a job link—or primarily sends a public job-posting URL, or asks to configure, save, remember, or update resume or public professional-profile references for job applications:

1. Read and follow the repository source coordinator at `skills/job-application-workflow/SKILL.md` first, even if the personal installed copy is absent. Invoke `$job-application-workflow` when available.
2. Complete readiness before processing a supplied link. The coordinator may offer to refresh personal skills after repository-source routing succeeds.
3. Preserve this exact ready message for the no-link path: “Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you're ready.”
4. Do not route unrelated repository development work through the application workflow.
5. Do not submit applications, use credentials, make private documents public, or modify the user's master resume.

# New User Setup Workflow

When setting up this project for a new user or new machine:

1. Read `README.md` and `docs/agent-setup.md`.
2. Collect the user's project location, private Google Docs URL first, DOCX/PDF fallback when needed, optional public profile context, whether they use Codex, Claude Code, or both, and whether their AI provider is configured in the host agent. Use `./applications` by default and do not ask for an application-materials path unless the user wants an override. Relative values must remain relative; never reinterpret `applications` as `/applications`.
3. Do not collect API keys or secrets in this repository; use the host agent's secure provider setup flow when needed.
4. For agent-owned installs, check `git`, `node`, and `npm`; install missing prerequisites with the system package manager or ask before using administrator privileges.
5. Run `npm install`, `npm run setup`, `npm run skills:install`, `npm run verify`, and `npm run build`.
6. Start the app with `npm run dev`, give the local URL, and tell the user setup is ready for the first job posting link.
7. Confirm `.env.local`, `data/*.sqlite`, resumes, and generated `applications/*` content remain private and uncommitted.

# Daily Discovery Setup Workflow

When the user asks to set up, enable, configure, repair, verify, or migrate recurring or daily qualified-job discovery:

1. Read and follow the repository source coordinator at `skills/daily-job-discovery-setup/SKILL.md` first, even if the personal installed copy is absent. Invoke `$daily-job-discovery-setup` when available.
2. Keep resume-derived preferences, locations, seniority, schedule, database identity, and local paths in ignored local configuration only.
3. Configure one scheduler owner even when both Codex and Claude skills are installed.
4. Reuse the existing JobTracker database and never create a fallback database.
5. Never submit applications or modify the master resume.
