import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { ConnectionConfig } from './types';

interface DbtOutput { [key: string]: unknown }
interface DbtProfile {
  [profileName: string]: {
    target: string;
    outputs: { [target: string]: DbtOutput };
  };
}

// ── Resolve dbt env_var() template strings ──────────────────────────────────
// dbt profiles often store credentials as {{ env_var('MY_VAR') }} or
// {{ env_var('MY_VAR', 'fallback') }}. js-yaml returns these as literal strings;
// we resolve them against process.env before handing to the DB driver.

function resolveValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  const m = str.match(/^\s*\{\{\s*env_var\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]*)['"]\s*)?\)\s*\}\}\s*$/);
  if (m) return process.env[m[1]] ?? m[2] ?? undefined;
  return str || undefined;
}

// ── Parse one dbt output block into a ConnectionConfig ──────────────────────

function parseOutput(output: DbtOutput): ConnectionConfig | null {
  const type = output['type'] as string;

  if (type === 'postgres' || type === 'redshift') {
    // dbt accepts both 'password' and 'pass' as aliases
    const password = resolveValue(output['password'] ?? output['pass']);
    return {
      type,
      host:     resolveValue(output['host']),
      port:     (output['port'] as number) || (type === 'redshift' ? 5439 : 5432),
      database: resolveValue(output['dbname'] ?? output['database']),
      user:     resolveValue(output['user']),
      password,
      // Use exactly what the profile says — no default schema imposed
      schema:   resolveValue(output['schema']),
    };
  }

  if (type === 'snowflake') {
    return {
      type: 'snowflake',
      account:   resolveValue(output['account']),
      user:      resolveValue(output['user']),
      password:  resolveValue(output['password'] ?? output['pass']),
      database:  resolveValue(output['database']),
      schema:    resolveValue(output['schema']),   // no hardcoded 'PUBLIC'
      warehouse: resolveValue(output['warehouse']),
      role:      resolveValue(output['role']),
    };
  }

  if (type === 'bigquery') {
    return {
      type:      'bigquery',
      projectId: resolveValue(output['project']),
      dataset:   resolveValue(output['dataset']),
      keyFile:   resolveValue(output['keyfile']),
    };
  }

  return null;
}

// ── File readers ────────────────────────────────────────────────────────────

export function tryProfilesFile(filePath: string): ConnectionConfig | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;

    const profiles = parsed as DbtProfile;

    // Detect dbt_project.yml (has 'name' + 'version' but no profile outputs)
    const firstVal = Object.values(profiles)[0];
    if ('name' in profiles && 'version' in profiles && firstVal && !('outputs' in firstVal)) {
      return null;
    }

    for (const key of Object.keys(profiles)) {
      if (key === 'config') continue;
      const profile = profiles[key];
      const output = profile?.outputs?.[profile.target];
      if (output) {
        const config = parseOutput(output);
        if (config) return config;
      }
    }
  } catch { /* ignore malformed files */ }
  return null;
}

export function tryBigQueryKeyFile(filePath: string): ConnectionConfig | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw.type === 'service_account' && raw.project_id) {
      return { type: 'bigquery', projectId: raw.project_id, keyFile: filePath };
    }
  } catch { /* ignore */ }
  return null;
}

function tryEnvFile(filePath: string): ConnectionConfig | null {
  if (!fs.existsSync(filePath)) return null;
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const host = env['DB_HOST'] || env['POSTGRES_HOST'] || env['DATABASE_HOST'];
  const user = env['DB_USER'] || env['POSTGRES_USER'] || env['DATABASE_USER'];
  const database = env['DB_NAME'] || env['POSTGRES_DB'] || env['DATABASE_NAME'];
  if (!host || !user || !database) return null;
  return {
    type: 'postgres',
    host,
    port: parseInt(env['DB_PORT'] || env['POSTGRES_PORT'] || '5432'),
    database,
    user,
    password: env['DB_PASSWORD'] || env['POSTGRES_PASSWORD'] || env['DATABASE_PASSWORD'] || '',
    schema: env['DB_SCHEMA'] || undefined,
  };
}

// ── Auto-detect ─────────────────────────────────────────────────────────────

const DEFAULT_PROFILES = path.join(os.homedir(), '.dbt', 'profiles.yml');

export async function detectConnection(): Promise<ConnectionConfig | null> {
  // 1. User-configured path takes priority
  const customPath = vscode.workspace.getConfiguration('dq-studio').get<string>('credentialsPath');
  if (customPath) {
    const expanded = customPath.replace(/^~/, os.homedir());
    const config = tryProfilesFile(expanded) ?? tryBigQueryKeyFile(expanded) ?? tryEnvFile(expanded);
    if (config) return config;
  }

  // 2. Default ~/.dbt/profiles.yml
  const fromProfiles = tryProfilesFile(DEFAULT_PROFILES);
  if (fromProfiles) return fromProfiles;

  // 3. Workspace .env
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const fromEnv = tryEnvFile(path.join(folder.uri.fsPath, '.env'));
    if (fromEnv) return fromEnv;
  }

  return null;
}

// ── Manual connection prompt ────────────────────────────────────────────────

export async function promptForConnection(): Promise<ConnectionConfig | null> {
  const dbType = await vscode.window.showQuickPick(
    [
      { label: '$(database) PostgreSQL', value: 'postgres' },
      { label: '$(database) Redshift', value: 'redshift' },
      { label: '$(server-environment) Snowflake', value: 'snowflake' },
      { label: '$(cloud) BigQuery', value: 'bigquery' },
      { label: '$(link) Connection string (Postgres / Redshift)', value: 'connstring' },
      { label: '$(files) Local files — CSV / Excel / Parquet (no database needed)', value: 'files' },
    ],
    { placeHolder: 'Select your database type — or point at local data files' }
  );
  if (!dbType) return null;

  // Local files: no credentials at all — each file becomes a table,
  // generated tests query the files with DuckDB
  if (dbType.value === 'files') {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { 'Data files (CSV, Excel, Parquet)': ['csv', 'xlsx', 'parquet'] },
      openLabel: 'Select data files',
      title: 'Select the CSV / Excel / Parquet files to build tests for',
    });
    if (!uris || uris.length === 0) return null;
    return {
      type: 'duckdb',
      files: uris.map(u => u.fsPath),
      database: 'local files',
    };
  }

  // BigQuery: browse for service account JSON
  if (dbType.value === 'bigquery') {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Service Account JSON': ['json'] },
      openLabel: 'Select service account key file',
      title: 'BigQuery — select your service account JSON key file',
    });
    if (!uris?.[0]) return null;
    const config = tryBigQueryKeyFile(uris[0].fsPath);
    if (!config) {
      vscode.window.showErrorMessage(
        'DQ Builder: file does not look like a BigQuery service account key. Expected {"type":"service_account","project_id":...}'
      );
      return null;
    }
    await persistPath(uris[0].fsPath);
    return config;
  }

  // Connection string shortcut for Postgres / Redshift
  if (dbType.value === 'connstring') {
    const str = await vscode.window.showInputBox({
      prompt: 'Enter a PostgreSQL or Redshift connection string',
      placeHolder: 'postgresql://user:password@host:5432/database',
      ignoreFocusOut: true,
    });
    if (!str) return null;
    try {
      const url = new URL(str);
      return {
        type: 'postgres' as const,
        host: url.hostname,
        port: parseInt(url.port || '5432'),
        database: url.pathname.replace('/', ''),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    } catch {
      vscode.window.showErrorMessage('DQ Builder: invalid connection string format.');
      return null;
    }
  }

  // All other types: browse for profiles.yml / .env
  // Default to ~/.dbt/ so users see profiles.yml immediately
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(path.join(os.homedir(), '.dbt')),
    filters: { 'dbt profiles / YAML / env': ['yml', 'yaml', 'env'] },
    openLabel: 'Select credentials file',
    title: 'Select your dbt profiles.yml or .env file',
  });
  if (!uris?.[0]) return null;

  const filePath = uris[0].fsPath;

  // Detect if the user accidentally selected dbt_project.yml
  if (path.basename(filePath) === 'dbt_project.yml') {
    vscode.window.showErrorMessage(
      'DQ Builder: that\'s a dbt project file, not a credentials file. Please select your profiles.yml (usually at ~/.dbt/profiles.yml).'
    );
    return null;
  }

  const config = tryProfilesFile(filePath) ?? tryEnvFile(filePath);
  if (!config) {
    vscode.window.showErrorMessage(
      'DQ Builder: could not parse a connection from that file. Make sure it\'s a valid dbt profiles.yml or .env file.'
    );
    return null;
  }

  await persistPath(filePath);
  return config;
}

async function persistPath(filePath: string) {
  await vscode.workspace.getConfiguration('dq-studio').update(
    'credentialsPath', filePath, vscode.ConfigurationTarget.Global
  );
}
