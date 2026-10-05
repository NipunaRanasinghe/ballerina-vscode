# Workflow docs journeys (E2E Group 5)

Each spec follows one published WSO2 Integrator workflow docs page, step by step, in the designer. Step ids and step text are the page's own. The group covers the two Get Started quickstarts and the Durable Workflow and Durable Agentic Workflow articles.

A spec fails only when a step cannot be completed in the product. A step that can be completed but differs from the page is recorded as a **finding** and the spec carries on. Examples: a control with another name, a missing field, a step the reader has to add. These are for the documentation team, not code fixes.

## Reading the findings

- Each finding is a `doc-finding` annotation on the test, and is also printed to the log with a `📝` prefix.
- A screenshot of the screen at that moment is attached as `finding N (<step>)`.
- All findings of a page are attached as `doc-findings` JSON, which includes the page URL.

Finding kinds:

| Kind | Meaning |
|---|---|
| `label` | The page names a control the UI calls something else. The spec used the UI's name. |
| `missing` | The page describes a field or option that is not on the form. |
| `behaviour` | Following the step does not give the result the page says. |
| `gap` | The page skips something the reader must do. |
| `clarity` | The step works but reads differently from the rest of the page. |
| `blocked` | The step needs something CI does not have, such as a Copilot sign-in. |

## Layout

| Path | What it holds |
|---|---|
| `doc-journey.ts` | Steps, findings, and the lookup that tries the page's name first and then the UI's |
| `integrator.ts` | The designer as a reader sees it: forms, node panel, diagram **+**, value helper |
| `project.ts` | Reading generated source, posting to the running service, reading the terminal |
| `common.ts` | Templates and doc paths shared by the specs |
| `quickstarts/`, `durable-workflow/`, `durable-agentic-workflow/` | One spec per docs page |
| `../data/workflow_*_project`, `../data/*_quickstart_project` | The projects the specs open |

Article specs open a template project that already holds what the article assumes, such as the order workflows or the claim-handling agent. The quickstarts start from an empty project with the page's integration name. Step 1 (creating the project from the home page) is covered by the project-creation tests.

## Adding a page

1. Add a spec under the folder that matches the docs section. Copy a neighbour's shape: `createTests()`, `initTest` with a template, a `DocJourney` with the page's title and slug, and one `j.step` per numbered step of the page.
2. Name controls by the page's name. Use `{ doc, ui }` when the UI is known to differ, so the difference becomes a `label` finding instead of a failure.
3. Register the spec in `../test.list.ts` under `Ballerina E2E Group 5`.

Run the group locally with:

```bash
pnpm exec playwright test -c e2e-test/playwright.config.js --grep @group5
```
