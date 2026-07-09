---
name: job-application-resume
description: Create tailored job-application resumes, reach-out messages, and application dossiers for specific job postings. Use when the user asks for a resume, resume customization, cover or reach-out message, fit assessment, interview prep, or application materials for a particular company or job posting; create a company folder and a Markdown qualification analysis for each new job application.
---

# Job Application Resume

## Core Workflow

Use this workflow for every new job-specific application.

1. Identify the company name and role title from the posting or user request.
2. Read local user configuration before creating files:
   - Prefer `JOBTRACKER_APPLICATIONS_DIR` from `.env.local` or the process environment.
   - Prefer `JOBTRACKER_BASE_RESUME_PATH` as the source resume when it is set.
   - Prefer `JOBTRACKER_LINKEDIN_URL` as profile context when it is set and public.
   - If required source material is missing, ask the human for it before drafting.
3. Create `<applications-dir>/<Company Name>/`. If no applications directory is configured, use `applications/<Company Name>/` under the current project. If the folder already exists, preserve it and add role-specific files without overwriting unrelated work.
4. Tailor the resume and any reach-out message from verified source material. Do not invent production AI, SDK, API, management, revenue, or customer claims that are not supported by the user's source materials.
5. Create a Markdown fit analysis inside the company folder before final delivery.
6. Register generated application-material files with the tracker record using `node scripts/register-application-artifact.mjs` so the app can display them on the application detail page.
7. If the user wants Google Docs output, deliver the resume as a Google Doc and include the Google Docs link in the final response. Keep local QA artifacts out of the final answer unless requested.

## Human Context To Collect

Collect only what is needed for the requested materials:

- Public profile URL, usually LinkedIn.
- Base resume path, PDF/DOCX/Markdown/text.
- Destination directory for generated application materials.
- Any role-specific constraints, such as geography, salary range, remote/hybrid preference, or companies to avoid.
- AI/provider credentials only through the host agent's approved secure setup flow; never ask the user to paste secrets into project files.

## Folder and File Naming

Use the actual company name from the job posting for the folder:

```text
<applications-dir>/<Actual Company Name>/
```

Use role-specific Markdown filenames to avoid collisions:

```text
<applications-dir>/<Actual Company Name>/<role-title-slug>-fit-analysis.md
```

Use lowercase hyphenated role slugs for filenames. If the role title is unknown, use `application-fit-analysis.md`. If a file already exists for the same role, update it only when the current request is for that same application; otherwise add a dated suffix.

## Register Files In The Tracker

After creating or updating an application-material file, link it to the existing tracker record:

```bash
node scripts/register-application-artifact.mjs \
  --company "Company Name" \
  --role "Role Title" \
  --type fit_analysis \
  --title "Fit Analysis" \
  --file "/absolute/path/to/company/role-fit-analysis.md"
```

Use these artifact types:

- `fit_analysis` for the qualification analysis Markdown file.
- `outreach_message` for recruiter, hiring-manager, or cold outreach drafts.
- `referral_message` for referral request drafts.
- `cover_letter` for cover letters.
- `resume` for tailored resumes.
- `posting` for saved posting files.
- `other` for supporting materials that do not fit another type.

If company and role matching is ambiguous, rerun the command with `--application-id <id>` from the verified tracker record. The Markdown file remains the source of truth; the database stores only the link and metadata.

## Required Markdown Analysis

Write the analysis in a direct, candid tone. Include these sections in this order:

```markdown
# <Company> - <Role> Fit Analysis

## Areas Where I Am Well-Qualified

## Areas Where I Am Partially Qualified

## Areas Where I Am Not Qualified

## Argument Points To Convince Them

## Interview Edge and Research Notes

## Sources
```

In the three qualification sections, compare the job posting against the user's verified experience. Separate direct evidence from reasonable inference. Be explicit about gaps rather than hiding them.

In `Argument Points To Convince Them`, give concise talking points the user can use in outreach, screening calls, recruiter conversations, and interviews. Tie each point to role requirements and real experience.

In `Interview Edge and Research Notes`, include practical preparation advice from quick research when available: company product direction, recent posts or launches, values, interview signals, public employee/recruiting notes, product docs, and credible review/interview sources. Treat Glassdoor and similar sources as anecdotal and label them as such.

In `Sources`, include links for the job posting if available and all online research sources used.

## Research Rules

Use web research when interview-edge notes or current company context could help the user. Prioritize:

- Official company careers, blog, product, docs, engineering, and investor/newsroom pages.
- Recent posts from company leadership or team members when accessible.
- Credible current news about the company, product, strategy, or market.
- Interview/review sites such as Glassdoor only as anecdotal signals, not facts.

If web access is unavailable or a source cannot be accessed, state that limitation in the analysis instead of fabricating details.

## Resume and Message Guidance

Write application materials to maximize fit without overstating:

- Mirror the role's language where accurate.
- Put the strongest matching evidence in the headline, summary, core skills, and first experience bullets.
- Convert weaker matches into adjacent strengths rather than false claims.
- Preserve meaningful gaps in the fit analysis even if they are omitted from the resume.
- Keep resumes company-neutral: do not name the target company, brand, product, or internal team directly in resume titles, visible resume content, filenames, or Google Doc titles. Use role- or domain-specific language instead, such as "Engineering Manager - Full-Stack Web/Mobile and Product-Led Delivery" rather than "<Company> Engineering Manager Resume."
- For reach-out messages, use the same evidence as the resume and explain why the role is a specific match.

This company-neutral resume rule applies only to resumes. The application folder, fit analysis Markdown, sources, interview notes, and reach-out messages should still use the actual company name when needed.

## Final Response

When finished, report:

- The resume or Google Docs link, if created.
- The application analysis Markdown path.
- Any important caveat, such as unavailable research or a qualification gap that should be prepared for in interviews.
