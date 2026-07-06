export type DataTypeCategory = 'integer' | 'numeric' | 'text' | 'timestamp' | 'boolean' | 'other';

export interface ColumnInfo {
  name: string;
  category: DataTypeCategory;
  rawType: string;
  isNullable: boolean;
}

export interface TableInfo {
  schema: string;
  table: string;
  columns: ColumnInfo[];
}

export type Framework = 'soda' | 'ge';

export interface CheckParam {
  name: string;
  label: string;
  type: 'number' | 'text' | 'list' | 'percentage' | 'duration';
  placeholder?: string;
}

export interface CheckDefinition {
  id: string;
  label: string;
  description: string;
  applies: DataTypeCategory[] | 'all';
  params: CheckParam[];
}

export interface SelectedCheck {
  columnName: string;
  checkId: string;
  params: Record<string, string>;
}

export interface CustomCheck {
  columnName: string;
  name: string;
  expression: string;
}

export interface GenerateRequest {
  framework: Framework;
  table: TableInfo;
  checks: SelectedCheck[];
  customChecks: CustomCheck[];
  connectionConfig?: ConnectionConfig;
}

export interface ConnectionConfig {
  type: 'postgres' | 'redshift' | 'snowflake' | 'bigquery' | 'duckdb';
  // Postgres / Redshift
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  schema?: string;
  // Snowflake-specific
  account?: string;
  warehouse?: string;
  role?: string;
  // BigQuery-specific
  projectId?: string;
  keyFile?: string;
  dataset?: string;
  // DuckDB local files — absolute paths to .csv / .parquet files
  files?: string[];
}
