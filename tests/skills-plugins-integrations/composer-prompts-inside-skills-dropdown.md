# Native Skills composer controls

Prerequisites: connect Codex 0.167.2 with an installed skill and an existing thread.

Actions: in light and dark themes, open Skills, select a skill, and send a message. Open its Skills Hub detail and toggle enabled state. Reload.

Expected: native selection, invocation and configuration remain available. No saved prompt creation, deletion, insertion, or Skill Try action appears. Existing prompt files remain unchanged.

Cleanup: restore the skill enabled state and remove only the test conversation if desired.

Performance audit: removed prompt list fetch on composer mount and the Try conversation workflow. Native skill calls are unchanged; no new requests or persistence were added. Live timings were not measured.
