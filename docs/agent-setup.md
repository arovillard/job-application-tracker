# Agent Setup Guide

Use this when setting up Job Application Tracker for a new human on a new machine.

## Collect From The Human

Ask for these values before configuring the project:

1. Where should the project live?
2. Where should generated application materials be stored?
3. What base resume file should be used for application-materials work?
4. What public profile URL, such as LinkedIn, should be used as profile context?
5. Is their AI provider already configured in the host agent?

Do not ask the human to paste API keys or credentials into this repository. If the host agent has a secure provider setup flow, use that flow.

## Setup Steps

1. Confirm prerequisites:

```bash
node --version
npm --version
python3 --version
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

4. Install the packaged skills:

```bash
npm run skills:install
```

5. Verify the project:

```bash
npm run verify
```

6. Start the app:

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
