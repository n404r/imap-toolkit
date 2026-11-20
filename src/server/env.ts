import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'),
  PORT: z.coerce.number().default(3000),
  DB_PATH: z.string().default('./data/imap-toolkit.db'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  for (const [field, errors] of Object.entries(
    parsed.error.flatten().fieldErrors
  )) {
    console.error(`   ${field}: ${(errors as string[]).join(', ')}`)
  }
  process.exit(1)
}

export const env = parsed.data
