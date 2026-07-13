# Next Job-Link Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End every successfully completed coordinated job-application workflow by inviting the user to send another job-posting link.

**Architecture:** Keep this behavior in the coordinating skill's final-response contract. Enforce the exact successful-completion sentence through the existing workflow contract test and mirror the provider-neutral skill byte-for-byte to Claude.

**Tech Stack:** Markdown skills, Vitest contract tests, agent setup documentation.

## Global Constraints

- Use exactly: `I'm ready for another job-posting link whenever you are.`
- Emit the sentence only after tracker intake, verification, and all requested materials complete successfully.
- Do not emit it for blocked, failed, incomplete, or awaiting-input workflows.
- Preserve the existing first-link readiness sentence unchanged.
- Preserve byte-identical Codex and Claude skill trees.

---

### Task 1: Add the successful-completion handoff

**Files:**

- Modify: `scripts/application-workflow-contract.test.ts`
- Modify: `skills/job-application-workflow/SKILL.md`
- Modify: `.claude/skills/job-application-workflow/SKILL.md`
- Modify: `docs/agent-setup.md`

**Interfaces:**

- Consumes the existing coordinator final-response step and provider parity contract.
- Produces the exact `nextLinkSentence` completion contract.

**Risk:** Low. Instruction and documentation behavior only.

- [ ] **Step 1: Write the failing contract test**

Add alongside `readySentence`:

```ts
const nextLinkSentence = "I'm ready for another job-posting link whenever you are.";
```

Add:

```ts
it("invites another link only after successful completion", () => {
  expect(workflow).toContain(nextLinkSentence);
  expect(workflow).toContain("only after tracker intake, verification, and all requested application-material work complete successfully");
  expect(workflow).toContain("Do not use this sentence when the workflow is blocked, failed, incomplete, or awaiting user input");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- scripts/application-workflow-contract.test.ts
```

Expected: FAIL because the coordinator does not contain `nextLinkSentence`.

- [ ] **Step 3: Implement the minimal coordinator behavior**

Append to the coordinator's successful final-response instruction:

```markdown
End the final response with exactly: “I'm ready for another job-posting link whenever you are.” Use this sentence only after tracker intake, verification, and all requested application-material work complete successfully. Do not use this sentence when the workflow is blocked, failed, incomplete, or awaiting user input.
```

Mirror the full coordinator `SKILL.md` to `.claude/skills/job-application-workflow/SKILL.md` without independent edits.

- [ ] **Step 4: Document the repeatable handoff**

Add the exact sentence and success-only condition to the application workflow section of `docs/agent-setup.md`. Keep the first-link readiness copy unchanged.

- [ ] **Step 5: Verify GREEN and repository contracts**

Run:

```bash
npm test -- scripts/application-workflow-contract.test.ts scripts/install-skills.test.ts
diff -qr skills .claude/skills
npm run verify
git diff --check
```

Expected: focused tests, provider parity, lint, typecheck, and full test suite pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/application-workflow-contract.test.ts skills/job-application-workflow/SKILL.md .claude/skills/job-application-workflow/SKILL.md docs/agent-setup.md
git commit -m "feat: invite the next job link"
```
