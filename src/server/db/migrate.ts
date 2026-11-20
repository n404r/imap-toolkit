#!/usr/bin/env tsx
import 'dotenv/config'
import { runMigrations } from './migrations.js'

await runMigrations()
console.log('Database is up to date.')
