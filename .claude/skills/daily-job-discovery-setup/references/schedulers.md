# Local Scheduler Reference

Use exactly one scheduler owner. Both provider skills may be installed, but two enabled daily schedules can repeat discovery after a lock is released.

## Shared Contract

- Use the saved local repository checkout and disable worktree isolation.
- Use the confirmed local time and IANA timezone from private configuration.
- Use the exact `scheduler.taskName` (`Daily qualified job preparation`), `scheduler.taskKey`, and generic `scheduler.prompt` emitted by `node scripts/check-daily-discovery-readiness.mjs`.
- Keep every role, location, path, resume fact, and database identity out of scheduler text.
- Reconcile by exact task name plus saved project directory. Update the owner match, disable every duplicate owner match, and disable every exact match in the non-owner provider. If a configured provider cannot be inspected, report setup incomplete and do not create a potentially duplicate task.
- Verify the saved task by reading it back. A created file or requested action is not proof that scheduling succeeded.
- Local tasks need the computer awake and the selected desktop app running. The JobTracker web server may be closed.
- Cloud execution is unsupported because a fresh clone cannot access the ignored local resume, SQLite database, or application materials.

## Codex in ChatGPT Desktop

Use the host's scheduled-task capability to create or update one local daily task. Bind it to the saved project directory with worktree isolation off and keep one exact name/project match. If that capability is unavailable, direct the human to open the saved project in Chat or Work mode in the ChatGPT desktop app, create the scheduled task there, and verify it under **Scheduled**. The Codex CLI and IDE extension cannot manage Scheduled. Do not claim the task was created when it was not inspected.

## Claude Desktop

Create or update a **Local** scheduled task in Claude Desktop with the saved project folder and worktree isolation disabled. Do not use `/loop`; it is session-scoped rather than a durable daily schedule. If task creation is unavailable in the current Claude surface, direct the human to Desktop **Routines → New routine → Local**, provide the readiness prompt and confirmed schedule, and do not claim it was created.

## Verification

Confirm one scheduler owner, one enabled exact-match task, no enabled duplicate or non-owner match, the correct saved folder, local execution, the confirmed daily schedule, and the generic prompt. Use **Run now** only after readiness passes. If a permission prompt prevents unattended execution, grant only the local-file, repository-command, and public-web access needed by this workflow or report the scheduler as incomplete.

Official product references:

- ChatGPT Scheduled tasks: <https://learn.chatgpt.com/docs/automations>
- Claude Desktop scheduled tasks: <https://code.claude.com/docs/en/desktop-scheduled-tasks>
