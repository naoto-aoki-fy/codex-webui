import { dirname, join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'

type DirectoryItem = {
  name: string
  path: string
  isDirectory: boolean
  mtimeMs: number
}

export type LocalDirectoryListingEntry = {
  name: string
  path: string
}

export type LocalDirectoryListing = {
  path: string
  parentPath: string
  entries: LocalDirectoryListingEntry[]
}

type LocalDirectoryListingOptions = {
  showHidden?: boolean
}

export function normalizeLocalPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('file://')) {
    try {
      return decodeURIComponent(trimmed.replace(/^file:\/\//u, ''))
    } catch {
      return trimmed.replace(/^file:\/\//u, '')
    }
  }
  return trimmed
}

function isHiddenName(value: string): boolean {
  return value.startsWith('.')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function normalizeNewProjectName(value: string): string {
  return value.trim().replace(/[\\/]+/gu, '').trim()
}

function toBrowseHref(pathValue: string, newProjectName = ''): string {
  const normalizedName = normalizeNewProjectName(newProjectName)
  const query = normalizedName ? `?newProjectName=${encodeURIComponent(normalizedName)}` : ''
  return `/codex-local-browse${encodeURI(pathValue)}${query}`
}

async function getDirectoryItems(localPath: string): Promise<DirectoryItem[]> {
  const entries = await readdir(localPath, { withFileTypes: true })
  const withMeta = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(localPath, entry.name)
    const entryStat = await stat(entryPath)
    return {
      name: entry.name,
      path: entryPath,
      isDirectory: entry.isDirectory(),
      mtimeMs: entryStat.mtimeMs,
    }
  }))
  return withMeta.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
}

function projectCreationTargetPath(parentPath: string, newProjectName: string): string {
  const normalizedName = normalizeNewProjectName(newProjectName)
  if (!normalizedName) return ''
  return join(parentPath, normalizedName)
}

function projectCreationButtonLabel(newProjectName: string): string {
  const normalizedName = normalizeNewProjectName(newProjectName)
  return normalizedName ? `Create ${normalizedName} here` : ''
}

function projectCreationStatusText(newProjectName: string): string {
  const normalizedName = normalizeNewProjectName(newProjectName)
  return normalizedName ? `Creating ${normalizedName} in Codex...` : 'Creating project in Codex...'
}

function openFolderStatusText(newProjectName: string): string {
  const normalizedName = normalizeNewProjectName(newProjectName)
  return normalizedName
    ? `Opening folder in Codex without creating ${normalizedName}...`
    : 'Opening folder in Codex...'
}

function failureStatusText(newProjectName: string): string {
  const normalizedName = normalizeNewProjectName(newProjectName)
  return normalizedName
    ? `Failed to open folder or create ${normalizedName}.`
    : 'Failed to open folder.'
}

function actionButtonsHtml(localPath: string, newProjectName: string): string {
  const normalizedName = normalizeNewProjectName(newProjectName)
  const createTargetPath = projectCreationTargetPath(localPath, normalizedName)
  const createButton = createTargetPath
    ? `<button class="header-open-btn create-project-btn" type="button" aria-label="${escapeHtml(projectCreationButtonLabel(normalizedName))}" title="${escapeHtml(projectCreationButtonLabel(normalizedName))}" data-path="${escapeHtml(createTargetPath)}" data-label="${escapeHtml(normalizedName)}" data-status="${escapeHtml(projectCreationStatusText(normalizedName))}" data-error="${escapeHtml(failureStatusText(normalizedName))}">${escapeHtml(projectCreationButtonLabel(normalizedName))}</button>`
    : ''
  const openButton = `<button class="header-open-btn open-folder-btn" type="button" aria-label="Open current folder in Codex" title="Open folder in Codex" data-path="${escapeHtml(localPath)}" data-label="" data-status="${escapeHtml(openFolderStatusText(normalizedName))}" data-error="${escapeHtml(failureStatusText(normalizedName))}">Open folder in Codex</button>`
  return `${createButton}${openButton}`
}

export async function getLocalDirectoryListing(
  localPath: string,
  options: LocalDirectoryListingOptions = {},
): Promise<LocalDirectoryListing> {
  const entries = await readdir(localPath, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(localPath, entry.name),
    }))
    .filter((entry) => options.showHidden === true || !isHiddenName(entry.name))
    .sort((a, b) => {
      const aHidden = isHiddenName(a.name)
      const bHidden = isHiddenName(b.name)
      if (aHidden !== bHidden) return aHidden ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })

  return {
    path: localPath,
    parentPath: dirname(localPath),
    entries: directories,
  }
}

export async function createDirectoryListingHtml(localPath: string, options?: { newProjectName?: string }): Promise<string> {
  const newProjectName = normalizeNewProjectName(options?.newProjectName ?? '')
  const items = await getDirectoryItems(localPath)
  const parentPath = dirname(localPath)
  const rows = items
    .map((item) => {
      const suffix = item.isDirectory ? '/' : ''
      return `<li class="file-row"><a class="file-link" href="${escapeHtml(toBrowseHref(item.path, newProjectName))}">${escapeHtml(item.name)}${suffix}</a></li>`
    })
    .join('\n')

  const parentLink = localPath !== parentPath
    ? `<a class="header-parent-link" href="${escapeHtml(toBrowseHref(parentPath, newProjectName))}">..</a>`
    : ''
  const pickerSummary = newProjectName
    ? `<p class="picker-summary">Browse to the parent folder where you want to create <strong>${escapeHtml(newProjectName)}</strong>, or open the current folder directly.</p>`
    : ''
  const actionButtons = actionButtonsHtml(localPath, newProjectName)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Index of ${escapeHtml(localPath)}</title>
  <style>
    body { font-family: ui-monospace, Menlo, Monaco, monospace; margin: 16px; background: #0b1020; color: #dbe6ff; }
    a { color: #8cc2ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; }
    .file-row { min-width: 0; }
    .file-link { display: block; padding: 10px 12px; border: 1px solid #28405f; border-radius: 10px; background: #0f1b33; overflow-wrap: anywhere; }
    .header-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
    .header-parent-link { color: #9ec8ff; font-size: 14px; padding: 8px 10px; border: 1px solid #2a4569; border-radius: 10px; background: #101f3a; }
    .header-parent-link:hover { text-decoration: none; filter: brightness(1.08); }
    .header-open-btn {
      height: 42px;
      padding: 0 14px;
      border: 1px solid #4f8de0;
      border-radius: 10px;
      background: linear-gradient(135deg, #2e6ee6 0%, #3d8cff 100%);
      color: #eef6ff;
      font-weight: 700;
      letter-spacing: 0.01em;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(33, 90, 199, 0.35);
    }
    .header-open-btn:hover { filter: brightness(1.08); }
    .header-open-btn:disabled { opacity: 0.6; cursor: default; }
    .picker-summary { margin: 10px 0 0; color: #b8d5ff; max-width: 60rem; line-height: 1.45; }
    .status { margin: 10px 0 0; color: #8cc2ff; min-height: 1.25em; }
    h1 { font-size: 18px; margin: 0; word-break: break-all; }
    @media (max-width: 640px) {
      body { margin: 12px; }
      .file-link { font-size: 15px; padding: 12px; }
    }
  </style>
</head>
<body>
  <h1>Index of ${escapeHtml(localPath)}</h1>
  ${pickerSummary}
  <div class="header-actions">
    ${parentLink}
    ${actionButtons}
  </div>
  <p id="status" class="status"></p>
  <ul>${rows}</ul>
  <script>
    const status = document.getElementById('status');
    document.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('.open-folder-btn, .create-project-btn');
      if (!(button instanceof HTMLButtonElement)) return;

      const path = button.getAttribute('data-path') || '';
      const label = button.getAttribute('data-label') || '';
      const statusText = button.getAttribute('data-status') || 'Opening folder in Codex...';
      const errorText = button.getAttribute('data-error') || 'Failed to open folder.';
      if (!path) return;
      button.disabled = true;
      status.textContent = statusText;
      try {
        const response = await fetch('/codex-api/project-root', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path,
            createIfMissing: button.classList.contains('create-project-btn'),
            label,
          }),
        });
        if (!response.ok) {
          status.textContent = errorText;
          button.disabled = false;
          return;
        }
        status.textContent = 'Folder opened. Returning to Codex...';
        const nextUrl = '/?openProjectPath=' + encodeURIComponent(path) + '#/';
        window.location.assign(nextUrl);
      } catch {
        status.textContent = errorText;
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`
}
