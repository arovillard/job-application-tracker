# Agent Setup Guide

Use this when setting up Job Application Tracker for a new human on a new machine.

## Collect From The Human

Ask for these values before configuring the project:

1. Where should the project live?
2. Where should generated application materials be stored?
3. What base resume file should be used for application-materials work?
4. What public profile URL, such as LinkedIn, should be used as profile context?
5. Are they using Codex, Claude Code, or both?
6. Is their AI provider already configured in the host agent?

Do not ask the human to paste API keys or credentials into this repository. If the host agent has a secure provider setup flow, use that flow.

## Agent-Owned Install Contract

When the human asks the agent to own installation end to end, complete the setup in this order:

1. Check for `git`, Node.js 20.18.1 or newer, and `npm`.
2. Install missing prerequisites with the system package manager, or ask before using administrator privileges.
3. Clone `https://github.com/arovillard/job-application-tracker` into the requested project folder, or update the existing local copy.
4. Install dependencies with `npm install`.
5. Collect the application-materials folder, latest resume file or path, public profile URL, and AI-provider status.
6. Run `npm run setup`, or write `.env.local` from `.env.example` using the collected values.
7. Run `npm run skills:install`.
8. If the human already has generated files in the application-materials folder, run `npm run artifacts:backfill`.
9. Run `npm run verify` and `npm run build`.
10. Start the app with `npm run dev`.
11. Confirm private files remain uncommitted.
12. Tell the human setup is complete, give the local app URL, and ask for the first job posting link.

## Setup Steps

1. Confirm prerequisites:

JobTracker requires **Node.js 20.18.1 or newer**.

```bash
node --version
npm --version
```

2. Install dependencies:

```bash
npm install
```

3. Run setup:

```bash
npm run setup
```

If you already collected the human's answers, you may write `.env.local` directly using `.env.example` as the template.

4. Install the packaged Codex and Claude skills:

```bash
npm run skills:install
```

Use a provider-specific command when the human only wants one agent configured:

```bash
npm run skills:install:codex
npm run skills:install:claude
```

5. Backfill existing generated files, if this is an existing install:

```bash
npm run artifacts:backfill
```

6. Verify the project:

```bash
npm run verify
```

7. Start the app:

```bash
npm run dev
```

## Application Workflow For Agents

When the human says "help me apply to this job" and provides a public job link:

1. Use `job-tracker-add-posting` to create or update the tracker record first.
2. Verify the script output shows the expected company, role, URL, status, action, and note ids.
3. Use `job-application-resume` before creating resumes, outreach, cover letters, interview notes, or fit analyses.
4. Use `JOBTRACKER_APPLICATIONS_DIR`, `JOBTRACKER_BASE_RESUME_PATH`, and `JOBTRACKER_LINKEDIN_URL` from `.env.local` when available.
5. Do not submit applications, sign in, or use credentials for the human.

If sources disagree about whether a posting is open, keep the tracker record active unless the human confirms it should be archived.
