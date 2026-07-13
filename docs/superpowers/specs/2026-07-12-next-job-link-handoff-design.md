# Next Job-Link Handoff Design

## Goal

Make a completed job-application workflow naturally reusable by telling the user that the agent is ready for another posting link.

## Behavior

After tracker intake, verification, and all requested application-material work complete successfully, the coordinating `job-application-workflow` skill must end its final response with exactly:

> I'm ready for another job-posting link whenever you are.

The invitation appears only when the requested workflow is complete. It must not appear when work is blocked, incomplete, awaiting user input, or when tracker/material verification failed.

The existing first-link readiness sentence remains unchanged:

> Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you're ready.

## Scope

- Update the Codex coordinator skill and its exact Claude mirror.
- Add a contract assertion for the exact completion sentence and its placement in the successful final-response instruction.
- Update agent-facing setup documentation so the repeatable handoff is explicit.

## Non-Goals

- Do not change readiness, tracker intake, resume generation, artifact registration, or error handling.
- Do not add the invitation to partial or failed workflows.
- Do not alter direct tracker-only or resume-only component-skill responses.

## Verification

- Coordinator skill validation succeeds.
- Codex and Claude skill trees remain byte-identical.
- Contract tests assert the exact completion sentence.
- The focused tests and full repository verification pass.
