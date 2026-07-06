import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { ColumnInfo, ConnectionConfig, DataTypeCategory } from './types';

// ── Type normalisation ──────────────────────────────────────────────────────

function normalizeType(raw: string): DataTypeCategory {
  const t = raw.toLowerCase();
  if (/^(int|integer|int2|int4|int8|bigint|smallint|serial|bigserial|fixed)/.test(t)) return 'integer';
  if (/^(float|float4|float8|real|double|numeric|decimal|money|bignumeric|number)/.test(t)) return 'numeric';
  if (/^(text|varchar|character varying|char|character|name|citext|uuid|string|nvarchar|nchar)/.test(t)) return 'text';
  if (/^(timestamp|date|time|datetime)/.test(t)) return 'timestamp';
  if (/^(bool|boolean)/.test(t)) return 'boolean';
  return 'other';
}

// ── Adapter interface ───────────────────────────────────────────────────────

export interface DbAdapter {
  testConnection(): Promise<void>;
  getSchemas(): Promise<string[]>;
  getTables(schema: string): Promise<string[]>;
  getColumns(schema: string, table: string): Promise<ColumnInfo[]>;
}

// ── PostgreSQL / Redshift ───────────────────────────────────────────────────

class PostgresAdapter implements DbAdapter {
  constructor(private config: ConnectionConfig) {}

  private newClient() {
    return new Client({
      host: this.config.host,
      port: this.config.port ?? 5432,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password ?? '',
      connectionTimeoutMillis: 5000,
      ssl: this.config.type === 'redshift' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async testConnection() {
    const c = this.newClient(); await c.connect(); await c.end();
  }

  async getSchemas() {
    const c = this.newClient(); await c.connect();
    try {
      const res = await c.query<{ schema_name: string }>(
        `SELECT schema_name FROM information_schema.schemata
         WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
         ORDER BY schema_name`
      );
      return res.rows.map(r => r.schema_name);
    } finally { await c.end(); }
  }

  async getTables(schema: string) {
    const c = this.newClient(); await c.connect();
    try {
      const res = await c.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [schema]
      );
      return res.rows.map(r => r.table_name);
    } finally { await c.end(); }
  }

  async getColumns(schema: string, table: string) {
    const c = this.newClient(); await c.connect();
    try {
      const res = await c.query<{
        column_name: string; udt_name: string; data_type: string; is_nullable: string;
      }>(
        `SELECT column_name, udt_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table]
      );
      return res.rows.map(r => ({
        name: r.column_name,
        rawType: r.udt_name || r.data_type,
        category: normalizeType(r.udt_name || r.data_type),
        isNullable: r.is_nullable === 'YES',
      }));
    } finally { await c.end(); }
  }
}

// ── Snowflake ───────────────────────────────────────────────────────────────

class SnowflakeAdapter implements DbAdapter {
  constructor(private config: ConnectionConfig) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async execute<T>(sql: string): Promise<T[]> {
    const sf = await import('snowflake-sdk');
    const conn = sf.default.createConnection({
      account: this.config.account!,
      username: this.config.user!,
      password: this.config.password!,
      database: this.config.database,
      warehouse: this.config.warehouse,
      schema: this.config.schema,
      role: this.config.role,
    });
    return new Promise((resolve, reject) => {
      conn.connect(err => {
        if (err) { reject(err); return; }
        conn.execute({
          sqlText: sql,
          complete: (err2, _stmt, rows) => {
            conn.destroy(() => {});
            if (err2) reject(err2);
            else resolve((rows ?? []) as T[]);
          },
        });
      });
    });
  }

  async testConnection() { await this.execute('SELECT 1'); }

  async getSchemas() {
    const rows = await this.execute<{ SCHEMA_NAME: string }>(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA
       WHERE SCHEMA_NAME != 'INFORMATION_SCHEMA' ORDER BY SCHEMA_NAME`
    );
    return rows.map(r => r.SCHEMA_NAME);
  }

  async getTables(schema: string) {
    const rows = await this.execute<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = '${schema}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`
    );
    return rows.map(r => r.TABLE_NAME);
  }

  async getColumns(schema: string, table: string) {
    const rows = await this.execute<{
      COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string;
    }>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'
       ORDER BY ORDINAL_POSITION`
    );
    return rows.map(r => ({
      name: r.COLUMN_NAME,
      rawType: r.DATA_TYPE,
      category: normalizeType(r.DATA_TYPE),
      isNullable: r.IS_NULLABLE === 'Y' || r.IS_NULLABLE === 'YES',
    }));
  }
}

// ── BigQuery ────────────────────────────────────────────────────────────────

class BigQueryAdapter implements DbAdapter {
  constructor(private config: ConnectionConfig) {}

  private async bq() {
    const { BigQuery } = await import('@google-cloud/bigquery');
    return new BigQuery({
      projectId: this.config.projectId ?? this.config.database,
      keyFilename: this.config.keyFile,
    });
  }

  async testConnection() {
    const client = await this.bq();
    await client.getDatasets({ maxResults: 1 });
  }

  async getSchemas() {
    const client = await this.bq();
    const [datasets] = await client.getDatasets();
    return datasets.map(d => d.id!).filter(Boolean).sort();
  }

  async getTables(schema: string) {
    const client = await this.bq();
    const [tables] = await client.dataset(schema).getTables();
    return tables.map(t => t.id!).filter(Boolean).sort();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const client = await this.bq();
    const [meta] = await client.dataset(schema).table(table).getMetadata();
    return (meta.schema?.fields ?? []).map((f: { name: string; type: string; mode: string }) => ({
      name: f.name,
      rawType: f.type,
      category: normalizeType(f.type),
      isNullable: f.mode !== 'REQUIRED',
    }));
  }
}

// ── Local files (CSV / Parquet) — schema inferred in-process ────────────────
// No database needed: the tree shows each file as a table under a 'files'
// schema. Generated tests query the files with DuckDB on the Python side.

export function fileStem(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

// Minimal CSV parser: handles quoted fields, embedded delimiters/newlines.
// Delimiter sniffed from the header line (comma, semicolon, tab, pipe).
function parseCsv(text: string, maxRows: number): string[][] {
  const headerLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const delimiter = [',', ';', '\t', '|']
    .map(d => ({ d, n: headerLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const rows: string[][] = [];
  let field = '', row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function isDateLike(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:?\d{2}|Z)?)?$/.test(v)
      || /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(v);
}

function inferCsvType(values: string[]): { rawType: string; category: DataTypeCategory } {
  const nonEmpty = values.filter(v => v.trim() !== '');
  if (nonEmpty.length === 0) return { rawType: 'varchar', category: 'text' };
  if (nonEmpty.every(v => /^(true|false)$/i.test(v)))                        return { rawType: 'boolean',   category: 'boolean' };
  if (nonEmpty.every(v => /^-?\d+$/.test(v)))                                return { rawType: 'bigint',    category: 'integer' };
  if (nonEmpty.every(v => /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)))   return { rawType: 'double',    category: 'numeric' };
  if (nonEmpty.every(isDateLike))                                            return { rawType: 'timestamp', category: 'timestamp' };
  return { rawType: 'varchar', category: 'text' };
}

const CSV_SAMPLE_BYTES = 256 * 1024;
const CSV_SAMPLE_ROWS  = 200;

function csvColumns(filePath: string): ColumnInfo[] {
  const fd = fs.openSync(filePath, 'r');
  let text: string;
  try {
    const buf = Buffer.alloc(Math.min(CSV_SAMPLE_BYTES, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    text = buf.toString('utf8');
  } finally { fs.closeSync(fd); }

  // Drop a possibly truncated last line from the sample
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline > 0 && text.length === CSV_SAMPLE_BYTES) text = text.slice(0, lastNewline);

  const rows = parseCsv(text, CSV_SAMPLE_ROWS + 1);
  if (rows.length === 0) throw new Error(`${path.basename(filePath)} appears to be empty`);

  const header = rows[0].map(h => h.trim());
  const sample = rows.slice(1);
  return header.map((name, idx) => {
    const values = sample.map(r => r[idx] ?? '');
    const { rawType, category } = inferCsvType(values);
    return {
      name: name || `column_${idx}`,
      rawType,
      category,
      isNullable: values.some(v => v.trim() === ''),
    };
  });
}

// ── Excel (.xlsx) — first sheet, sampled ────────────────────────────────────
// SheetJS typed cells arrive as real JS values (cellDates gives Date objects),
// so inference works on types rather than string patterns.

const XLSX_SAMPLE_ROWS = 200;

function inferCellType(values: unknown[]): { rawType: string; category: DataTypeCategory } {
  const nonNull = values.filter(v => v !== null && v !== undefined && v !== '');
  if (nonNull.length === 0) return { rawType: 'varchar', category: 'text' };
  if (nonNull.every(v => v instanceof Date))        return { rawType: 'timestamp', category: 'timestamp' };
  if (nonNull.every(v => typeof v === 'boolean'))   return { rawType: 'boolean',   category: 'boolean' };
  if (nonNull.every(v => typeof v === 'number')) {
    return nonNull.every(v => Number.isInteger(v as number))
      ? { rawType: 'bigint', category: 'integer' }
      : { rawType: 'double', category: 'numeric' };
  }
  if (nonNull.every(v => typeof v === 'string' && isDateLike(v))) return { rawType: 'timestamp', category: 'timestamp' };
  return { rawType: 'varchar', category: 'text' };
}

async function xlsxColumns(filePath: string): Promise<ColumnInfo[]> {
  const XLSX = await import('xlsx');
  // Read the buffer ourselves: XLSX.readFile needs an fs reference that
  // esbuild-bundled code doesn't provide, XLSX.read(buffer) is bundler-safe
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, sheetRows: XLSX_SAMPLE_ROWS + 1 });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(`${path.basename(filePath)} has no sheets`);

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null }) as unknown[][];
  if (rows.length === 0) throw new Error(`${path.basename(filePath)} appears to be empty`);

  const header = rows[0].map(h => (h === null || h === undefined ? '' : String(h).trim()));
  const sample = rows.slice(1);
  return header.map((name, idx) => {
    const values = sample.map(r => r[idx] ?? null);
    return {
      name: name || `column_${idx}`,
      ...inferCellType(values),
      isNullable: values.some(v => v === null || v === ''),
    };
  });
}

// hyparquet SchemaElement — declared locally to keep the import dynamic-safe
interface ParquetSchemaElement {
  name: string;
  type?: string;
  num_children?: number;
  converted_type?: string;
  logical_type?: { type: string };
  repetition_type?: string;
}

function parquetType(el: ParquetSchemaElement): { rawType: string; category: DataTypeCategory } {
  const logical = el.logical_type?.type;
  const converted = el.converted_type;
  if (logical === 'TIMESTAMP' || logical === 'DATE' || el.type === 'INT96'
      || converted === 'TIMESTAMP_MILLIS' || converted === 'TIMESTAMP_MICROS' || converted === 'DATE') {
    return { rawType: 'timestamp', category: 'timestamp' };
  }
  if (logical === 'DECIMAL' || converted === 'DECIMAL') return { rawType: 'decimal', category: 'numeric' };
  if (logical === 'STRING' || converted === 'UTF8')     return { rawType: 'varchar', category: 'text' };
  switch (el.type) {
    case 'BOOLEAN':               return { rawType: 'boolean', category: 'boolean' };
    case 'INT32': case 'INT64':   return { rawType: el.type.toLowerCase(), category: 'integer' };
    case 'FLOAT': case 'DOUBLE':  return { rawType: el.type.toLowerCase(), category: 'numeric' };
    case 'BYTE_ARRAY':
    case 'FIXED_LEN_BYTE_ARRAY':  return { rawType: 'varchar', category: 'text' };
    default:                      return { rawType: String(el.type ?? 'unknown').toLowerCase(), category: 'other' };
  }
}

async function parquetColumns(filePath: string): Promise<ColumnInfo[]> {
  const { parquetMetadata } = await import('hyparquet');
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const meta = parquetMetadata(ab as ArrayBuffer);
  const elements = (meta.schema as ParquetSchemaElement[]).slice(1); // [0] is the root
  return elements
    .filter(el => !el.num_children) // leaf columns only; nested groups are skipped
    .map(el => ({
      name: el.name,
      ...parquetType(el),
      isNullable: el.repetition_type !== 'REQUIRED',
    }));
}

class LocalFilesAdapter implements DbAdapter {
  constructor(private config: ConnectionConfig) {}

  private files(): string[] { return this.config.files ?? []; }

  async testConnection() {
    if (this.files().length === 0) throw new Error('No data files selected.');
    const missing = this.files().filter(f => !fs.existsSync(f));
    if (missing.length > 0) throw new Error(`File not found: ${missing.join(', ')}`);
  }

  async getSchemas() { return ['files']; }

  async getTables() { return this.files().map(fileStem).sort(); }

  async getColumns(_schema: string, table: string): Promise<ColumnInfo[]> {
    const file = this.files().find(f => fileStem(f) === table);
    if (!file) throw new Error(`No local file matches table "${table}"`);
    const lower = file.toLowerCase();
    if (lower.endsWith('.parquet')) return parquetColumns(file);
    if (lower.endsWith('.xlsx'))    return xlsxColumns(file);
    return csvColumns(file);
  }
}

// ── Factory + public DbClient ───────────────────────────────────────────────

export function createAdapter(config: ConnectionConfig): DbAdapter {
  switch (config.type) {
    case 'snowflake': return new SnowflakeAdapter(config);
    case 'bigquery':  return new BigQueryAdapter(config);
    case 'duckdb':    return new LocalFilesAdapter(config);
    default:          return new PostgresAdapter(config);
  }
}

// Thin wrapper kept so schemaTreeProvider doesn't need changes
export class DbClient implements DbAdapter {
  private adapter: DbAdapter;
  readonly connectionConfig: ConnectionConfig;
  constructor(config: ConnectionConfig) {
    this.adapter = createAdapter(config);
    this.connectionConfig = config;
  }
  testConnection()               { return this.adapter.testConnection(); }
  getSchemas()                   { return this.adapter.getSchemas(); }
  getTables(s: string)           { return this.adapter.getTables(s); }
  getColumns(s: string, t: string) { return this.adapter.getColumns(s, t); }
}
