# Explicit attachments and native file search

Setup: use a disposable conversation on a supported external Codex server, with
an uploaded image and a workspace containing fuzzy filename matches.

1. Send `save the attached screenshot` without selecting a new attachment.
   Expect the new submission to contain text only; the historical image still renders.
2. Select/paste a new image and submit. Expect that image in the submission and history.
3. Search with a non-contiguous filename query. Expect native fuzzy matches in
   server order; choose one and verify the attached path. Try no matches and a
   disconnected server; expect an empty list and an error respectively.

Cleanup: remove only the disposable conversation/files through supported controls.
No historical uploads or application state are automatically removed.
