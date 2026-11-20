### Plan card contrast in light and dark themes

#### Feature/Change Name
Plan cards, including fenced code blocks, use a light surface with dark text in Light and a dark surface with light text in Dark.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. A thread contains a completed plan with headings, inline code, a quote, a table, and a fenced code block

#### Steps
1. Set Appearance to `Light` and open the thread containing the plan.
2. Inspect the card title, explanation, steps, table, quote, inline code, and the fenced code block with its language label.
3. Verify that `Copy plan` and `Implement plan` are readable. Hover `Implement plan` and verify that its hover state is visible.
4. Set Appearance to `Dark`, return to the same thread, and repeat steps 2–3.

#### Expected Results
- The card and code block have light backgrounds with dark text in Light and dark backgrounds with light text in Dark.
- Text, headings, inline code, file links, table cells, step labels, and syntax highlighting remain readable in both themes.
- The card surface and controls are distinguishable from their surroundings in both themes.

#### Rollback/Cleanup
- Reset appearance to the previous user preference

---
