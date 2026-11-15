### User message Revert split-button actions (CAP-001)

Requirement: [CAP-001 Fork and Revert](../../docs/product-requirements.md#cap-001-fork-and-revert).
This active checklist replaces the older description of the primary action as
in-place rollback. The visible main label remains `Revert`; changing that label
is separate UI work.

#### Prerequisites/Setup

Use an independently managed App Server and a disposable persisted thread with
three completed turns and a recognizable second prompt. Stop active turns and
start with an empty destination draft. Record the source URL and history.

#### Steps and expected results

1. Open the thread and hover or keyboard-focus the second user message. In light
   and dark themes, expect a back-arrow main button visibly labeled `Revert`, with
   tooltip and accessibility name `Fork and Revert`, plus a `Revert options` arrow.
   Assistant responses must not show the old `Rollback` action.
2. Click the main button. Expect a separate destination containing only the first
   turn and the second prompt restored as an editable composer draft. Expect no
   automatic generation. Reopen the source URL: all three turns remain intact.
3. Return to the destination and reload. Expect the same historical prefix and
   restored draft. Edit and explicitly submit it; only then expect a new response.
4. On another disposable source, open the arrow and select `Fork and Revert`.
   Expect the same non-destructive behavior as the main button.
5. On a separate disposable source, select `Revert` from the arrow menu. Expect
   in-place truncation from the selected turn and prompt restoration into the
   current composer, without a separate destination. Existing composer text is
   retained and the restored prompt appended. Do not use a valued source here.
6. Compare assistant-response Fork: it retains the selected response inclusively,
   unlike Fork and Revert's history preceding the selected user message.

#### Cleanup

Archive disposable destinations and sources, clear test drafts and restore the
original theme. In-place Revert removes history; resubmission generates a new
response rather than restoring the original. Neither action rolls back files.
