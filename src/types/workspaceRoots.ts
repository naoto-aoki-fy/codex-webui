/** Native project operations never change project files or conversation contents. */
export type WorkspaceRootsOperation = {
  type: 'delete' | 'rename' | 'move'; projectId: string; name?: string; beforeProjectId?: string | null
}
