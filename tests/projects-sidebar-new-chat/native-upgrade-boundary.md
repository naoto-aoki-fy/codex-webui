# Native Project and pin behavior with historical local state

Setup: use a disposable profile/home and a server satisfying the
[native capability contract](../../docs/native-project-migration.md).

1. Seed a legacy root, an unfinished Project receipt and a legacy pin in the
   local state file. Record its bytes.
2. Register an actual native Project. Create a thread and pin it using the
   application. Reload and reconnect. The sidebar shows native Projects and
   pins, including the new values. The legacy-only root and pin stay absent.
3. Read the local state file again. Project and pin operations leave the
   original bytes intact.
4. Return method-not-found for Project or pin listing. Upgrade guidance appears
   and ordinary conversation navigation still works. Permission and transport
   errors retain their own messages.

Cleanup: remove only the disposable projects, threads and local fixture profile.
The credential-free coverage is in `src/server/nativeProjects.test.ts`,
`src/server/nativeThreadPins.test.ts`, `src/server/projectHistory.test.ts` and
`src/components/sidebar/SidebarThreadTree.test.ts`.
