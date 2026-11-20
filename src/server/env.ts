import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required'),
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
