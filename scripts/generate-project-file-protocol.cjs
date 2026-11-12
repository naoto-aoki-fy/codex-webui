// Generate only the protocol slice used by the project filesystem adapter.
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readdirSync, copyFileSync, readFileSync, mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname, resolve, relative } = require('node:path')
const binary = join(process.cwd(), 'node_modules/.bin/codex')
const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
if (version !== 'codex-cli 0.167.2') throw new Error(`Expected codex-cli 0.167.2; got ${version}`)
const temp = mkdtempSync(join(tmpdir(), 'codex-project-protocol-'))
try {
  execFileSync(binary, ['app-server', 'generate-ts', '--experimental', '--out', temp], { stdio: 'inherit' })
  const target = join(process.cwd(), 'src/server/protocol/0.167.2')
  mkdirSync(join(target, 'v2'), { recursive: true })
  for (const name of ['AbsolutePathBuf.ts', 'InitializeResponse.ts']) copyFileSync(join(temp, name), join(target, name))
  for (const name of readdirSync(join(temp, 'v2')).filter(name => /^Fs.*\.ts$/.test(name))) copyFileSync(join(temp, 'v2', name), join(target, 'v2', name))
  const copied = new Set()
  function copyType(source) {
    if (copied.has(source)) return
    copied.add(source)
    const destination = join(target, relative(temp, source))
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    for (const match of readFileSync(source, 'utf8').matchAll(/from "([^"]+)"/g)) {
      copyType(resolve(dirname(source), match[1] + '.ts'))
    }
  }
  for (const name of ['v2/CommandExecParams.ts', 'v2/CommandExecResponse.ts', 'FuzzyFileSearchParams.ts', 'FuzzyFileSearchResponse.ts']) copyType(join(temp, name))
} finally { rmSync(temp, { recursive: true, force: true }) }
