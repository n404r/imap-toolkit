import 'dotenv/config'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { env } from './env.js'
import { runMigrations } from './db/migrations.js'
import { getDb } from './db/connection.js'
import { accountRepo } from './repositories/account.repo.js'
import { filterRepo } from './repositories/filter.repo.js'
import { logRepo } from './repositories/log.repo.js'
import { purgeRepo } from './repositories/purge.repo.js'
import { WatcherManager } from './watcher/imap-watcher.js'
import { hashPassword, generateSalt } from './lib/crypto.js'
import { ImapFlow } from 'imapflow'
import { isSenderOnlyFilter, runInstantPurge, runBackgroundPurgeJob } from './services/purge.service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Bootstrap ───────────────────────────────────────────────────────────────

await runMigrations()

// Sync admin password from env
const db = getDb()
const salt = generateSalt()
const hash = hashPassword(env.ADMIN_PASSWORD, salt)
await db.execute({
  sql: `INSERT INTO admin_settings (id, password_hash, password_salt, updated_at)
        VALUES (1, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          password_hash = excluded.password_hash,
          password_salt = excluded.password_salt,
          updated_at = excluded.updated_at`,
  args: [hash, salt],
})

// ─── Fastify server ───────────────────────────────────────────────────────────

const app = Fastify({ logger: { level: env.LOG_LEVEL } })

await app.register(fastifyCors, {
  origin: (process.env['NODE_ENV'] ?? 'development') === 'production' ? false : 'http://localhost:5173',
  credentials: true,
})

await app.register(fastifyCookie)

await app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
  cookie: { cookieName: 'token', signed: false },
})

// ─── Auth helper ─────────────────────────────────────────────────────────────

app.decorate('authenticate', async (request: any, reply: any) => {
  try {
    await request.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

// ─── Watcher manager ─────────────────────────────────────────────────────────

let cachedFilters: import('./types.js').Filter[] = []
// Keep filter cache fresh – watchers call this synchronously
async function refreshFilterCache() {
  cachedFilters = await filterRepo.findEnabled()
}

const manager = new WatcherManager(() => cachedFilters, app.log as any)

const accounts = await accountRepo.findAll()
await refreshFilterCache()
manager.startAll(accounts)

// Refresh filter cache every 30s so watcher picks up changes without restart
setInterval(() => { void refreshFilterCache() }, 30_000)

// ─── Auth routes ─────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (request, reply) => {
  const { password } = request.body as { password?: string }
  if (!password) return reply.code(400).send({ error: 'password required' })

  const res = await db.execute('SELECT password_hash, password_salt FROM admin_settings WHERE id = 1')
  const row = res.rows[0]
  if (!row) return reply.code(500).send({ error: 'admin not configured' })

  const hash = hashPassword(password, String(row['password_salt']))
  if (hash !== String(row['password_hash']))
    return reply.code(401).send({ error: 'Invalid password' })

  const token = app.jwt.sign({ role: 'admin' }, { expiresIn: '7d' })
  reply.setCookie('token', token, {
    httpOnly: true,
    secure: (process.env['NODE_ENV'] ?? '') === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return { ok: true }
})

app.post('/api/auth/logout', async (_req, reply) => {
  reply.clearCookie('token', { path: '/' })
  return { ok: true }
})

app.get('/api/auth/me', { onRequest: [app.authenticate] }, async () => {
  return { role: 'admin' }
})

// ─── Account routes ───────────────────────────────────────────────────────────

app.get('/api/accounts', { onRequest: [app.authenticate] }, async () => {
  const all = await accountRepo.findAll()
  return all.map((a) => {
    const stats = manager.getStats(a.id)
    return {
      ...a,
      password_enc: undefined,
      reconnect_at: stats?.reconnect_at ?? null,
    }
  })
})

app.post('/api/accounts', { onRequest: [app.authenticate] }, async (req, reply) => {
  const body = req.body as any
  const account = await accountRepo.create({
    label: body.label,
    email: body.email,
    imap_host: body.imap_host,
    imap_port: body.imap_port ?? 993,
    imap_secure: body.imap_secure ?? true,
    password: body.password,
    watched_folders: body.watched_folders,
  })
  manager.addWatcher(account)
  return reply.code(201).send({ ...account, password_enc: undefined })
})

app.patch('/api/accounts/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
  const id = parseInt((req.params as any).id)
  const body = req.body as any
  const account = await accountRepo.update(id, body)
  if (!account) return reply.code(404).send({ error: 'not found' })
  manager.restartWatcher(account)
  return { ...account, password_enc: undefined }
})

app.get('/api/accounts/:id/folders', { onRequest: [app.authenticate] }, async (req, reply) => {
  const id = parseInt((req.params as any).id)
  const account = await accountRepo.findById(id)
  if (!account) return reply.code(404).send({ error: 'not found' })
  const password = accountRepo.getPassword(account)
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure,
    auth: { user: account.email, pass: password },
    logger: false,
  })
  try {
    await client.connect()
    const list = await client.list()
    await client.logout().catch(() => {})
    return list.map((m) => ({
      path: m.path,
      name: m.name,
      specialUse: m.specialUse || null,
      flags: Array.from(m.flags || []),
    }))
  } catch (err: any) {
    await client.logout().catch(() => {})
    return reply.code(400).send({ error: err.message ?? 'Failed to list folders' })
  }
})

app.post('/api/accounts/test-folders', { onRequest: [app.authenticate] }, async (req, reply) => {
  const body = req.body as any
  const client = new ImapFlow({
    host: body.imap_host,
    port: body.imap_port ?? 993,
    secure: body.imap_secure ?? true,
    auth: { user: body.email, pass: body.password },
    logger: false,
  })
  try {
    await client.connect()
    const list = await client.list()
    await client.logout().catch(() => {})
    return list.map((m) => ({
      path: m.path,
      name: m.name,
      specialUse: m.specialUse || null,
      flags: Array.from(m.flags || []),
    }))
  } catch (err: any) {
    await client.logout().catch(() => {})
    return reply.code(400).send({ error: err.message ?? 'Connection failed' })
  }
})

app.delete('/api/accounts/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
  const id = parseInt((req.params as any).id)
  manager.removeWatcher(id)
  const ok = await accountRepo.delete(id)
  if (!ok) return reply.code(404).send({ error: 'not found' })
  return { ok: true }
})

app.post('/api/accounts/:id/reconnect', { onRequest: [app.authenticate] }, async (req, reply) => {
  const id = parseInt((req.params as any).id)
  const account = await accountRepo.findById(id)
  if (!account) return reply.code(404).send({ error: 'not found' })
  manager.reconnectWatcher(account.id)
  return { ok: true }
})

// ─── Filter routes ────────────────────────────────────────────────────────────

app.get('/api/filters', { onRequest: [app.authenticate] }, async () => {
  return filterRepo.findAll()
})

app.post('/api/filters', { onRequest: [app.authenticate] }, async (req, reply) => {
  const body = req.body as any
  const filter = await filterRepo.create({
    name: body.name,
    logic: body.logic ?? 'AND',
    conditions: body.conditions ?? [],
  })
  void refreshFilterCache()
  return reply.code(201).send(filter)
})

app.patch('/api/filters/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
  const id = parseInt((req.params as any).id)
  const body = req.body as any
  const filter = await filterRepo.update(id, body)
  if (!filter) return reply.code(404).send({ error: 'not found' })
  void refreshFilterCache()
  return filter
})

app.delete('/api/filters/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
  const id = parseInt((req.params as any).id)
  const ok = await filterRepo.delete(id)
  if (!ok) return reply.code(404).send({ error: 'not found' })
  void refreshFilterCache()
  return { ok: true }
})

app.post('/api/filters/:id/purge', { onRequest: [app.authenticate] }, async (req, reply) => {
  const id = parseInt((req.params as any).id)
  const body = (req.body as any) || {}
  const filter = await filterRepo.findById(id)
  if (!filter) return reply.code(404).send({ error: 'filter not found' })

  let accountsToScan: import('./types.js').Account[] = []
  if (body.account_id) {
    const acc = await accountRepo.findById(parseInt(body.account_id))
    if (acc) accountsToScan.push(acc)
  } else {
    const all = await accountRepo.findAll()
    accountsToScan = all.filter((a) => a.enabled)
  }

  if (accountsToScan.length === 0) {
    return reply.code(400).send({ error: 'No active accounts to scan' })
  }

  const isSenderOnly = isSenderOnlyFilter(filter)

  if (isSenderOnly) {
    let totalDeleted = 0
    let totalScanned = 0
    for (const acc of accountsToScan) {
      const res = await runInstantPurge(acc, filter, { maxDays: body.max_days ?? 90 })
      totalDeleted += res.deleted
      totalScanned += res.scanned
    }
    return {
      mode: 'instant',
      deleted: totalDeleted,
      scanned: totalScanned,
    }
  }

  // Content-based filter -> Background job
  const jobs: number[] = []
  for (const acc of accountsToScan) {
    for (const folder of acc.watched_folders.length > 0 ? acc.watched_folders : ['INBOX']) {
      const job = await purgeRepo.create({
        filter_id: filter.id,
        account_id: acc.id,
        folder,
      })
      jobs.push(job.id)
      void runBackgroundPurgeJob(job.id, acc, filter, { maxDays: body.max_days ?? 90 })
    }
  }

  return {
    mode: 'background',
    jobIds: jobs,
    status: 'running',
  }
})

app.get('/api/filters/:id/purge-jobs', { onRequest: [app.authenticate] }, async (req) => {
  const id = parseInt((req.params as any).id)
  return purgeRepo.findByFilter(id)
})

// ─── Logs routes ──────────────────────────────────────────────────────────────

app.get('/api/logs', { onRequest: [app.authenticate] }, async (req) => {
  const q = req.query as any
  return logRepo.findAll({
    account_id: q.account_id ? parseInt(q.account_id) : undefined,
    search: q.search,
    limit: q.limit ? parseInt(q.limit) : 50,
    offset: q.offset ? parseInt(q.offset) : 0,
  })
})

// ─── Mailbox stats route ───────────────────────────────────────────────────────

app.get('/api/stats/accounts', { onRequest: [app.authenticate] }, async () => {
  return manager.getAllStats()
})

// ─── Dashboard ────────────────────────────────────────────────────────────────

app.get('/api/dashboard', { onRequest: [app.authenticate] }, async () => {
  const [stats, accounts] = await Promise.all([logRepo.stats(), accountRepo.findAll()])
  return {
    stats,
    accounts: accounts.map((a) => {
      const mStats = manager.getStats(a.id)
      return {
        id: a.id,
        label: a.label,
        email: a.email,
        status: a.status,
        status_msg: a.status_msg,
        reconnect_at: mStats?.reconnect_at ?? null,
        enabled: a.enabled,
      }
    }),
  }
})

// ─── Serve React panel ────────────────────────────────────────────────────────

const clientDist = path.resolve(process.cwd(), 'dist/client')
if (fs.existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist, prefix: '/' })
  app.setNotFoundHandler((_req, reply) => {
    reply.sendFile('index.html')
  })
}

// ─── Start ────────────────────────────────────────────────────────────────────

await app.listen({ port: env.PORT, host: '0.0.0.0' })
app.log.info(`🚀 NeMo IMAP running on port ${env.PORT}`)

const shutdown = () => {
  manager.stopAll()
  void app.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
