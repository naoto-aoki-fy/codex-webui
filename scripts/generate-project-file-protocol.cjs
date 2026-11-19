// Generate the protocol slices imported by the application from pinned Codex.
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
  const roots = new Set()
  function inspectConsumers(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (file !== target) inspectConsumers(file)
      } else if (/\.(ts|vue)$/.test(entry.name)) {
        for (const match of readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\s*\()(['"])([^'"]*protocol\/0\.167\.2\/[^'"]+)\1/g)) {
          const source = resolve(dirname(file), match[2].replace(/\.js$/, '') + '.ts')
          roots.add(relative(target, source))
        }
      }
    }
  }
  inspectConsumers(join(process.cwd(), 'src'))
  for (const name of roots) copyType(join(temp, name))
  function removeStale(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) removeStale(file)
      else if (entry.name.endsWith('.ts') && !copied.has(join(temp, relative(target, file)))) rmSync(file)
    }
  }
  removeStale(target)
} finally { rmSync(temp, { recursive: true, force: true }) }
