/** Removing a workspace only unregisters it; files are preserved. */
export type WorkspaceRootsOperation = { type: 'delete'; path: string }
