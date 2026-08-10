import { randomUUID } from 'crypto'
import { getDatabase } from '../../db/database'

/**
 * Config templates: a body with `{{PLACEHOLDER}}` tokens plus a field schema
 * describing what each one wants.
 */

export interface TemplateField {
  name: string
  description: string
  required: boolean
  default?: string
  isSecret?: boolean
}

export interface ConfigTemplate {
  id: string
  name: string
  kind: string
  fields: TemplateField[]
  body: string
  isSecret: boolean
  builtin: boolean
}

export interface RenderResult {
  body: string
  missing: string[]
  /** Field names that were filled with a secret value. */
  secretFields: string[]
}

const TOKEN = /\{\{(\w+)\}\}/g

export function renderTemplate(template: ConfigTemplate, values: Record<string, string>): RenderResult {
  const missing: string[] = []
  const secretFields: string[] = []
  const byName = new Map(template.fields.map((f) => [f.name, f]))

  const body = template.body.replace(TOKEN, (whole, name: string) => {
    const field = byName.get(name)
    const supplied = values[name]

    if (supplied !== undefined && supplied !== '') {
      if (field?.isSecret) secretFields.push(name)
      return supplied
    }
    if (field?.default !== undefined) return field.default
    if (field?.required !== false) missing.push(name)
    // Left as the token rather than blanked: a half-rendered file with a
    // visible {{TOKEN}} is obviously incomplete, where an empty value looks
    // deliberate and gets committed.
    return whole
  })

  return { body, missing: [...new Set(missing)], secretFields }
}

export function listTemplates(): ConfigTemplate[] {
  const rows = getDatabase().prepare('SELECT * FROM config_templates ORDER BY name').all() as any[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    fields: JSON.parse(r.fields_json ?? '[]'),
    body: r.body,
    isSecret: !!r.is_secret,
    builtin: !!r.builtin,
  }))
}

export function getTemplate(idOrName: string): ConfigTemplate | null {
  const db = getDatabase()
  const row =
    (db.prepare('SELECT * FROM config_templates WHERE id = ?').get(idOrName) as any) ??
    (db.prepare('SELECT * FROM config_templates WHERE lower(name) = lower(?)').get(idOrName) as any)
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    fields: JSON.parse(row.fields_json ?? '[]'),
    body: row.body,
    isSecret: !!row.is_secret,
    builtin: !!row.builtin,
  }
}

interface Starter {
  name: string
  kind: string
  fields: TemplateField[]
  body: string
  isSecret?: boolean
}

const STARTERS: Starter[] = [
  {
    name: '.env (Node/Vite)',
    kind: 'env',
    isSecret: true,
    fields: [
      { name: 'APP_NAME', description: 'Application name', required: true, default: 'my-app' },
      { name: 'PORT', description: 'Dev server port', required: false, default: '5173' },
      { name: 'API_BASE_URL', description: 'Backend base URL', required: false, default: 'http://localhost:3000' },
      { name: 'DATABASE_URL', description: 'Postgres connection string', required: false, isSecret: true },
      { name: 'API_KEY', description: 'Third-party API key', required: false, isSecret: true },
    ],
    body: `# {{APP_NAME}}
# Local development environment. Do not commit this file.

PORT={{PORT}}
VITE_API_BASE_URL={{API_BASE_URL}}

DATABASE_URL={{DATABASE_URL}}
API_KEY={{API_KEY}}
`,
  },
  {
    name: '.gitignore (Node/Python/Windows)',
    kind: 'gitignore',
    fields: [],
    body: `# Dependencies
node_modules/
.pnp/
.venv/
venv/
__pycache__/
*.py[cod]

# Build output
dist/
build/
out/
.next/
.nuxt/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# Editors
.vscode/*
!.vscode/extensions.json
.idea/
*.swp

# Windows
Thumbs.db
Desktop.ini
$RECYCLE.BIN/

# Logs
*.log
npm-debug.log*
coverage/
`,
  },
  {
    name: 'tsconfig.json',
    kind: 'tsconfig',
    fields: [
      { name: 'TARGET', description: 'Compile target', required: false, default: 'ES2022' },
      { name: 'OUTDIR', description: 'Output directory', required: false, default: 'dist' },
    ],
    body: `{
  "compilerOptions": {
    "target": "{{TARGET}}",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["{{TARGET}}", "DOM", "DOM.Iterable"],
    "outDir": "{{OUTDIR}}",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "{{OUTDIR}}"]
}
`,
  },
  {
    name: 'ESLint + Prettier',
    kind: 'lint',
    fields: [],
    body: `// eslint.config.js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  }
)

/* --- .prettierrc ---
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "es5"
}
*/
`,
  },
  {
    name: 'GitHub Actions — Node CI',
    kind: 'ci',
    fields: [
      { name: 'NODE_VERSION', description: 'Node version', required: false, default: '20' },
      { name: 'BRANCH', description: 'Branch to run on', required: false, default: 'main' },
    ],
    body: `name: CI

on:
  push:
    branches: [{{BRANCH}}]
  pull_request:
    branches: [{{BRANCH}}]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '{{NODE_VERSION}}'
          cache: npm
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test --if-present
`,
  },
  {
    name: 'docker-compose — Postgres + Redis',
    kind: 'docker',
    isSecret: true,
    fields: [
      { name: 'POSTGRES_DB', description: 'Database name', required: true, default: 'app' },
      { name: 'POSTGRES_USER', description: 'Database user', required: true, default: 'postgres' },
      { name: 'POSTGRES_PASSWORD', description: 'Database password', required: true, isSecret: true },
      { name: 'PG_PORT', description: 'Host port for Postgres', required: false, default: '5432' },
      { name: 'REDIS_PORT', description: 'Host port for Redis', required: false, default: '6379' },
    ],
    body: `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: {{POSTGRES_DB}}
      POSTGRES_USER: {{POSTGRES_USER}}
      POSTGRES_PASSWORD: {{POSTGRES_PASSWORD}}
    ports:
      - "{{PG_PORT}}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U {{POSTGRES_USER}}"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "{{REDIS_PORT}}:6379"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
`,
  },
]

/** Inserts the shipped templates once. Idempotent, so it is safe on every boot. */
export function seedTemplates(): number {
  const db = getDatabase()
  const exists = db.prepare('SELECT COUNT(*) AS n FROM config_templates WHERE builtin = 1').get() as { n: number }
  if (exists.n > 0) return 0

  const insert = db.prepare(
    `INSERT INTO config_templates (id, name, kind, fields_json, body, is_secret, builtin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  )
  const now = Date.now()
  db.transaction(() => {
    for (const starter of STARTERS) {
      insert.run(
        randomUUID(),
        starter.name,
        starter.kind,
        JSON.stringify(starter.fields),
        starter.body,
        starter.isSecret ? 1 : 0,
        now
      )
    }
  })()
  return STARTERS.length
}
