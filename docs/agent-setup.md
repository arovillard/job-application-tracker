# Agent Setup Guide

Use this when setting up Opportunity Tracker for a new human on a new machine.

## Start Application Work

The nontechnical entrypoint is not an npm command. Open the repository in Codex or Claude Code and say:

```text
help me apply
```

In a fresh session, repository instructions route the request through `job-application-workflow`; the flow does not rely on earlier chat memory. It runs readiness before asking for or processing a job link and, when no link is present, finishes with:

> Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you're ready.

A local fresh session can reuse ignored `.env.local` references and local files after revalidation. A cloud checkout does not contain that private state, so it asks for the resume source again unless the same settings are configured as cloud environment variables. A new host session may also require the user to reconnect Google Drive.

The human can save the resume and public profile together without using an npm or terminal command by telling the agent:

```text
Configure my reusable application profile for this project.
Master resume Google Doc: https://docs.google.com/document/d/EXAMPLE_DOCUMENT_ID/edit
LinkedIn profile: https://www.linkedin.com/in/example
Save these in the project's private local configuration, verify readiness, and tell me when I am ready to provide a job link.
```

Replace the examples with the human's values. For a local file, use `Master resume file:` and its full path. The coordinator persists the resume as `JOBTRACKER_BASE_RESUME_URL` or `JOBTRACKER_BASE_RESUME_PATH` and the profile as `JOBTRACKER_LINKEDIN_URL` in ignored `.env.local`. It must persist every supplied allowlisted value together and omit values the human did not supply so existing configuration remains unchanged.

Fresh local sessions reload these values. For Codex Cloud, configure the same names as cloud environment variables because ignored `.env.local` is not cloned. A saved Google Docs URL identifies the resume but does not replace Google Drive authorization.

## Collect From The Human

Ask for these values before configuring the project:

1. Where should the project live?
2. Where should generated application materials be stored?
3. What private Google Docs master resume should be used? If they prefer a file, ask for DOCX first or PDF as a supported fallback with a formatting warning.
4. What public profile URL, such as LinkedIn, should be used as optional profile context?
5. Are they using Codex, Claude Code, or both?
6. Is their AI provider already configured in the host agent?

Do not ask the human to paste API keys or credentials into this repository. If the host agent has a secure provider setup flow, use that flow.

Google Docs is preferred because the agent can preserve formatting while creating a role-specific copy. Use the host's connected Google capability to verify the exact private document; never ask the human to make it public. The configured master is read-only and must not be modified.

## Agent-Owned Install Contract

When the human asks the agent to own installation end to end, complete the setup in this order:

1. Check for `git`, `node`, and `npm`.
2. Install missing prerequisites with the system package manager, or ask before using administrator privileges.
3. Clone `https://github.com/arovillard/job-application-tracker` into the requested project folder, or update the existing local copy.
4. Install dependencies with `npm install`.
5. Collect the application-materials folder, Google Docs resume URL or DOCX/PDF fallback, optional public profile URL, and AI-provider status.
6. Run `npm run setup`, or write `.env.local` from `.env.example` using the collected values.
7. Run `npm run skills:install`.
8. If the human already has generated files in the application-materials folder, run `npm run artifacts:backfill`.
9. Run `npm run verify` and `npm run build`.
10. Start the app with `npm run dev`.
11. Confirm private files remain uncommitted.
12. Tell the human setup is complete, give the local app URL, and ask for the first job posting link.

## Setup Steps

1. Confirm prerequisites:

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

The preferred resume setting is `JOBTRACKER_BASE_RESUME_URL`. `JOBTRACKER_BASE_RESUME_PATH` remains compatible for DOCX, PDF, Markdown, or text sources. A missing resume prevents tailored materials; a missing profile produces only a warning.

Agents can inspect readiness without exposing resume contents or credentials:

```bash
node scripts/check-application-readiness.mjs
```

To safely update only application-profile references while preserving unrelated `.env.local` entries and comments:

```bash
printf '%s\n' '{"baseResumeUrl":"https://docs.google.com/document/d/DOCUMENT_ID/edit"}' |
  node scripts/configure-application-profile.mjs --input-json -
```

The configuration command accepts only `applicationsDirectory`, `baseResumeUrl`, `baseResumePath`, and `profileUrl`; it does not accept provider credentials.

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

## Job Opportunity Workflow For Agents

When the human expresses application intent, with or without a public job link:

1. Use `job-application-workflow` and run `check-application-readiness.mjs` before processing the link.
2. For a Google Doc, verify private connected access and create a role-specific copy; offer DOCX when access is unavailable and warn that PDF formatting is less reliable.
3. Use `job-tracker-add-posting` to create or update the job opportunity first, then verify its type, organization, label, URL, status, action, and activity ids.
4. Use `job-application-resume` only after tracker verification, with the readiness result's exact database and applications paths.
5. When a tailored Google Doc is created, export a local PDF or DOCX snapshot before registering the `resume` artifact. Return the Google Docs link separately and never modify the master.
6. Treat a missing profile as a warning, not a blocker. Do not submit applications, sign in, make a document public, or use credentials for the human.

After tracker intake, verification, and all requested application-material work complete successfully, end the final response with exactly: “I'm ready for another job-posting link whenever you are.” Do not use this sentence when the workflow is blocked, failed, incomplete, or awaiting user input.

If sources disagree about whether a posting is open, keep the tracker record active unless the human confirms it should be archived.
