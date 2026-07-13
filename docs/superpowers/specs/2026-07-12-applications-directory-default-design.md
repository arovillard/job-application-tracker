# Repository-Local Applications Directory Design

## Problem

`JOBTRACKER_APPLICATIONS_DIR` is intended to identify the private folder that stores generated resumes, fit analyses, outreach drafts, and posting snapshots. A user entered `applications`, intending the repository's `applications/` folder, but the persisted value became `/applications`. On macOS, that path aliases the system `/Applications` directory, so generated job materials were written beside installed applications.

The setup command already resolves relative paths from the repository root. The application-profile configuration boundary, however, accepts an agent-supplied absolute `/applications` value without distinguishing it from the intended repository-relative path. Readiness also treats a missing setting as unconfigured even though the repository already documents `applications/` as the normal local destination.

## Desired Behavior

- The default application-materials directory is `<project-root>/applications`.
- Missing or blank `JOBTRACKER_APPLICATIONS_DIR` values use that default.
- Relative values such as `applications`, `./applications`, or `private/applications` resolve from the repository root.
- Explicit custom absolute paths remain supported.
- The ambiguous filesystem-root path `/applications` is rejected with a message directing the user to `./applications` for the repository-local default or to a different explicit absolute path.
- Configuration summaries and readiness output continue returning an absolute resolved path for downstream commands.
- Existing private output remains ignored by Git.

## Configuration Boundary

Path rules will live in the shared application-readiness/configuration module so setup, profile updates, readiness checks, and summaries use the same interpretation.

When the default is selected, `.env.local` should store the portable value `./applications`. A relative custom path should also remain repository-relative in `.env.local`; an absolute custom path should remain absolute. Setup prompts and agent instructions must state that relative paths are based on the repository root and that users can accept the default without supplying a path.

The validation error for `/applications` is intentional even on systems where it would technically be writable. A root-level directory named only `applications` is too easy to confuse with the repository default and is hazardous on case-insensitive macOS filesystems.

## Existing-Installation Changes

README documentation will include two cases:

1. To change the destination before materials exist, update `JOBTRACKER_APPLICATIONS_DIR` in `.env.local` (or use the application configuration command), create the target directory if needed, and restart the development server.
2. To change it after materials exist, stop the development server, move the existing material folders to the new destination, update the setting, run `npm run artifacts:backfill -- --applications-dir "/absolute/new/path"`, and restart the app.

The artifact backfill will remove local artifact records whose referenced files no longer exist before registering files found in the selected directory. This prevents a directory move from leaving broken duplicate links while retaining valid artifact records.

For the current workspace only, move `/Applications/Example Company` to `<project-root>/applications/Example Company`, change `.env.local` to `JOBTRACKER_APPLICATIONS_DIR="./applications"`, and refresh artifact links. Do not touch any macOS applications or unrelated files under `/Applications`.

## Documentation and Agent Guidance

Update the README configuration, quick-start, application-materials, development, and agent-managed setup guidance to explain:

- no application-materials path is required for the default setup;
- `./applications` means the folder inside the repository;
- relative and absolute override examples;
- how to change the destination on an existing installation;
- when to run artifact backfill and restart the app.

Update repository and Claude workflow skills plus setup guidance so agents do not ask for an application-materials directory unless the user wants to override the default. Agents must pass relative user input through unchanged and must never reinterpret `applications` as `/applications`.

## Tests

Add regression coverage proving that:

- absent and blank values resolve to `<project-root>/applications`;
- `applications` and `./applications` resolve to the repository folder;
- a custom absolute path is preserved;
- `/applications` is rejected before `.env.local` is modified;
- setup stores the portable default and creates the resolved repository directory;
- backfill removes missing local artifact records and registers files from a moved directory;
- README and packaged workflow contracts contain the default and migration guidance.

Run focused tests during the red-green cycle, then run lint, type checking, the complete test suite, and the production build.

## Safety and Compatibility

- Do not modify the master resume.
- Do not move or alter system applications.
- Do not overwrite an existing destination folder during the one-time local migration; stop and report a collision instead.
- Continue allowing arbitrary non-ambiguous absolute custom destinations.
- Preserve unrelated `.env.local` entries, comments, and restrictive file permissions.
