import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { updateCodexGlobalState } from './codexGlobalState.js'
import { resolveWebuiStorage, storageNames } from './webuiStorage.mjs'
import type { RequestHandler, Request, Response, NextFunction } from 'express'

const TOKEN_COOKIE = 'portal_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_PERSISTED_TOKENS = 128

type PersistedAuthState = {
  tokens?: Array<{
    value?: unknown
    expiresAt?: unknown
  }>
}

function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    cookies[key] = value
  }
  return cookies
}

function sessionTokens(state: PersistedAuthState): Map<string, number> {
  const now = Date.now()
  const sessions = new Map<string, number>()
  for (const entry of Array.isArray(state?.tokens) ? state.tokens : []) {
    const token = typeof entry?.value === 'string' ? entry.value : ''
    const expiresAt = typeof entry?.expiresAt === 'number' ? entry.expiresAt : 0
    if (token && Number.isFinite(expiresAt) && expiresAt > now) sessions.set(token, expiresAt)
  }
  return sessions
}

function readPersistedSessions(path: string): Map<string, number> {
  try {
    return sessionTokens(JSON.parse(readFileSync(path, 'utf8')) as PersistedAuthState)
  } catch {
    return new Map()
  }
}

async function persistSession(path: string, token: string, expiresAt: number): Promise<void> {
  try {
    await updateCodexGlobalState(state => {
      const sessions = sessionTokens(state)
      sessions.set(token, expiresAt)
      state.tokens = [...sessions]
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_PERSISTED_TOKENS)
        .map(([value, expiresAt]) => ({ value, expiresAt }))
    }, path, true)
  } catch (error) {
    console.warn('[auth] failed to persist login sessions:', error)
  }
}

function buildSessionCookie(token: string, expiresAt: number): string {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  return [
    `${TOKEN_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(maxAgeSeconds)}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join('; ')
}

function isAuthorizedByRequestLike(
  cookieHeader: string | undefined,
  validTokens: Map<string, number>,
): boolean {
  const cookies = parseCookies(cookieHeader)
  const token = cookies[TOKEN_COOKIE]
  if (!token) return false
  const expiresAt = validTokens.get(token)
  return typeof expiresAt === 'number' && expiresAt > Date.now()
}

const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex WebUI</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
.card{background:#171717;border:1px solid #262626;border-radius:12px;padding:2rem;width:100%;max-width:380px}
h1{font-size:1.25rem;font-weight:600;margin-bottom:1.5rem;text-align:center;color:#fafafa}
label{display:block;font-size:.875rem;color:#a3a3a3;margin-bottom:.5rem}
input{width:100%;padding:.625rem .75rem;background:#0a0a0a;border:1px solid #404040;border-radius:8px;color:#fafafa;font-size:1rem;outline:none;transition:border-color .15s}
input:focus{border-color:#3b82f6}
button{width:100%;padding:.625rem;margin-top:1rem;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:.9375rem;font-weight:500;cursor:pointer;transition:background .15s}
button:hover{background:#2563eb}
.error{color:#ef4444;font-size:.8125rem;margin-top:.75rem;text-align:center;display:none}
</style>
</head>
<body>
<div class="card">
<h1>Codex WebUI</h1>
<form id="f">
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Sign in</button>
<p class="error" id="err">Incorrect password</p>
</form>
</div>
<script>
const form=document.getElementById('f');
const errEl=document.getElementById('err');
form.addEventListener('submit',async e=>{
  e.preventDefault();
  errEl.style.display='none';
  const res=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
  if(res.ok){window.location.reload()}else{errEl.style.display='block';document.getElementById('pw').value='';document.getElementById('pw').focus()}
});
</script>
</body>
</html>`

export type AuthSession = {
  middleware: RequestHandler
  isRequestAuthorized: (req: IncomingMessage) => boolean
}

export function createAuthSession(password: string): AuthSession {
  const path = join(resolveWebuiStorage().data, storageNames.global, storageNames.authSessions)
  const validTokens = readPersistedSessions(path)
  async function login(res: Response): Promise<void> {
    const token = randomBytes(32).toString('hex')
    const now = Date.now()
    const expiresAt = now + SESSION_TTL_MS
    for (const [value, expiration] of validTokens) {
      if (expiration <= now) validTokens.delete(value)
    }
    validTokens.set(token, expiresAt)
    await persistSession(path, token, expiresAt)
    res.setHeader('Set-Cookie', buildSessionCookie(token, expiresAt))
  }

  const middleware: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAuthorizedByRequestLike(req.headers.cookie, validTokens)) {
      next()
      return
    }

    // Handle login POST
    if (req.method === 'POST' && req.path === '/auth/login') {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', async () => {
        let parsed: { password?: string }
        try {
          parsed = JSON.parse(body) as { password?: string }
        } catch {
          res.status(400).json({ error: 'Invalid request body' })
          return
        }

        const provided = typeof parsed.password === 'string' ? parsed.password : ''
        if (!constantTimeCompare(provided, password)) {
          res.status(401).json({ error: 'Invalid password' })
          return
        }

        try {
          await login(res)
          res.json({ ok: true })
        } catch {
          res.status(500).json({ error: 'Failed to create login session' })
        }
      })
      return
    }

    // Handle one-click auth links like /password=<value>
    if (req.method === 'GET' && req.path.startsWith('/password=')) {
      const provided = req.path.slice('/password='.length)
      if (constantTimeCompare(provided, password)) {
        await login(res)
        res.redirect(302, '/')
        return
      }
    }

    // No valid session — serve login page
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(LOGIN_PAGE_HTML)
  }

  return {
    middleware,
    isRequestAuthorized: (req: IncomingMessage) => (
      isAuthorizedByRequestLike(req.headers.cookie, validTokens)
    ),
  }
}
