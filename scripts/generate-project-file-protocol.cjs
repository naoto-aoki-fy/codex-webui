// Generate the protocol slices imported by the application from pinned Codex.
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readdirSync, copyFileSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
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
  const dtoSource = readFileSync(join(process.cwd(), 'src/api/appServerDtos.ts'), 'utf8')
  const dtoTypes = [...dtoSource.matchAll(/protocol\/0\.167\.2\/([^'"]+)/g)].map(match => match[1])
  for (const name of ['v2/CommandExecParams', 'v2/CommandExecResponse', 'FuzzyFileSearchParams', 'FuzzyFileSearchResponse', ...dtoTypes]) copyType(join(temp, name + '.ts'))
  const methods = name => [...new Set([...readFileSync(join(temp, name + '.ts'), 'utf8').matchAll(/"method": "([^"]+)"/g)].map(match => match[1]))].sort()
  writeFileSync(join(process.cwd(), 'src/server/appServerMethods.json'), JSON.stringify({ methods: methods('ClientRequest'), notifications: methods('ServerNotification') }, null, 2) + '\n')
} finally { rmSync(temp, { recursive: true, force: true }) }
