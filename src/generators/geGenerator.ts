import { ConnectionConfig, CustomCheck, GenerateRequest, SelectedCheck } from '../types';

// ── Connection string with real values, password placeholder ────────────────

function connectionStringTemplate(cfg: ConnectionConfig | undefined, schema: string): string {
  if (!cfg) return 'postgresql+psycopg2://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/YOUR_DATABASE';

  switch (cfg.type) {
    case 'snowflake': {
      const u  = cfg.user      ?? 'YOUR_USER';
      const a  = cfg.account   ?? 'YOUR_ACCOUNT';
      const db = cfg.database  ?? 'YOUR_DATABASE';
      const sc = cfg.schema    ?? schema;
      const wh = cfg.warehouse ?? 'YOUR_WAREHOUSE';
      const rl = cfg.role      ?? 'YOUR_ROLE';
      return `snowflake://${u}:YOUR_PASSWORD@${a}/${db}/${sc}?warehouse=${wh}&role=${rl}`;
    }
    case 'bigquery': {
      const project = cfg.projectId ?? cfg.database ?? 'YOUR_PROJECT';
      const dataset = cfg.dataset ?? schema;
      const base = `bigquery://${project}/${dataset}`;
      return cfg.keyFile ? `${base}?credentials_path=${cfg.keyFile}` : base;
    }
    case 'redshift': {
      const u  = cfg.user     ?? 'YOUR_USER';
      const h  = cfg.host     ?? 'YOUR_HOST';
      const p  = cfg.port     ?? 5439;
      const db = cfg.database ?? 'YOUR_DATABASE';
      return `redshift+redshift_connector://${u}:YOUR_PASSWORD@${h}:${p}/${db}`;
    }
    case 'duckdb':
      // In-memory engine; the query asset reads the file directly
      return 'duckdb:///:memory:';
    default: {
      const u  = cfg.user     ?? 'YOUR_USER';
      const h  = cfg.host     ?? 'YOUR_HOST';
      const p  = cfg.port     ?? 5432;
      const db = cfg.database ?? 'YOUR_DATABASE';
      return `postgresql+psycopg2://${u}:YOUR_PASSWORD@${h}:${p}/${db}`;
    }
  }
}

function installLine(type: ConnectionConfig['type'] | undefined): string {
  switch (type) {
    case 'snowflake': return `# pip install 'great_expectations[snowflake]'`;
    case 'bigquery':  return `# pip install 'great_expectations[bigquery]'`;
    case 'redshift':  return `# pip install 'great_expectations[redshift]'`;
    case 'duckdb':    return `# pip install great_expectations duckdb duckdb-engine`;
    default:          return `# pip install 'great_expectations[postgresql]'`;
  }
}

// DuckDB SELECT over the local file backing this table.
// read_xlsx autoloads DuckDB's excel core extension on first use.
function duckdbFileQuery(cfg: ConnectionConfig | undefined, table: string): string {
  const file = cfg?.files?.find(f => {
    const base = f.split(/[\\/]/).pop() ?? f;
    return base.replace(/\.[^.]+$/, '') === table;
  }) ?? `/path/to/${table}.csv`;
  const escaped = file.replace(/'/g, "''");
  const lower = file.toLowerCase();
  if (lower.endsWith('.parquet')) return `SELECT * FROM read_parquet('${escaped}')`;
  // header auto-detection is unreliable — always name columns from the first row
  if (lower.endsWith('.xlsx'))    return `SELECT * FROM read_xlsx('${escaped}', header = true)`;
  return `SELECT * FROM read_csv_auto('${escaped}')`;
}

// Escape a value for embedding in a double-quoted Python string
function pyStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Per-check rendering ─────────────────────────────────────────────────────

function renderCheck(c: SelectedCheck): string {
  const p = c.params;
  const col = `column="${c.columnName}"`;
  const add = (expectation: string) => `suite.add_expectation(gx.expectations.${expectation})`;

  switch (c.checkId) {
    case 'not_null':
      return add(`ExpectColumnValuesToNotBeNull(${col})`);
    case 'unique':
      return add(`ExpectColumnValuesToBeUnique(${col})`);
    case 'null_percent':
      return add(`ExpectColumnValuesToNotBeNull(${col}, mostly=${p['mostly']})`);
    case 'values_in_set': {
      const vals = p['values'].split(',').map(v => `"${v.trim()}"`).join(', ');
      return add(`ExpectColumnValuesToBeInSet(${col}, value_set=[${vals}])`);
    }
    case 'values_not_in_set': {
      const vals = p['values'].split(',').map(v => `"${v.trim()}"`).join(', ');
      return add(`ExpectColumnValuesToNotBeInSet(${col}, value_set=[${vals}])`);
    }
    case 'unique_proportion':
      return add(`ExpectColumnProportionOfUniqueValuesToBeBetween(${col}, min_value=${p['min']}, max_value=${p['max']})`);
    case 'min_between':
      return add(`ExpectColumnMinToBeBetween(${col}, min_value=${p['min']}, max_value=${p['max']})`);
    case 'max_between':
      return add(`ExpectColumnMaxToBeBetween(${col}, min_value=${p['min']}, max_value=${p['max']})`);
    case 'mean_between':
      return add(`ExpectColumnMeanToBeBetween(${col}, min_value=${p['min']}, max_value=${p['max']})`);
    case 'sum_between':
      return add(`ExpectColumnSumToBeBetween(${col}, min_value=${p['min']}, max_value=${p['max']})`);
    case 'stdev_between':
      return add(`ExpectColumnStdevToBeBetween(${col}, min_value=${p['min']}, max_value=${p['max']})`);
    case 'quantile_between':
      return [
        `suite.add_expectation(gx.expectations.ExpectColumnQuantileValuesToBeBetween(`,
        `    ${col},`,
        `    quantile_ranges={"quantiles": [${p['quantile']}], "value_ranges": [[${p['min']}, ${p['max']}]]},`,
        `))`,
      ].join('\n');
    case 'length_between':
      return add(`ExpectColumnValueLengthsToBeBetween(${col}, min_value=${p['min']}, max_value=${p['max']})`);
    case 'match_regex':
      return add(`ExpectColumnValuesToMatchRegex(${col}, regex=r"${p['regex']}")`);
    case 'strftime_format':
      return add(`ExpectColumnValuesToMatchStrftimeFormat(${col}, strftime_format="${p['format']}")`);
    case 'date_parseable':
      return add(`ExpectColumnValuesToBeDateutilParseable(${col})`);
    case 'date_between':
      return add(`ExpectColumnValuesToBeBetween(${col}, min_value="${p['min']}", max_value="${p['max']}")`);
    default:
      return `# unknown check: ${c.checkId}`;
  }
}

// Custom checks run as native SQL in the connected warehouse: rows returned by
// the query (i.e. rows matching the fail condition) fail the expectation.
// {batch} is replaced by GX with the configured table asset at run time.
function renderCustom(c: CustomCheck): string {
  return [
    `suite.add_expectation(gx.expectations.UnexpectedRowsExpectation(`,
    `    unexpected_rows_query="SELECT * FROM {batch} WHERE ${pyStr(c.expression)}",`,
    `    description="${pyStr(c.name)}",`,
    `))`,
  ].join('\n');
}

// ── Main generator ──────────────────────────────────────────────────────────

export function generateGE(req: GenerateRequest): string {
  const { table, checks, customChecks, connectionConfig } = req;
  const isDuckDb  = connectionConfig?.type === 'duckdb';
  const fqn       = isDuckDb ? `${table.table} (local file)` : `${table.schema}.${table.table}`;
  const suiteName = `${table.table}_suite`;
  const dsName    = `${table.schema}_datasource`;
  const valName   = `${table.table}_validation`;

  const connStr = connectionStringTemplate(connectionConfig, table.schema);
  // BigQuery and DuckDB connection strings carry no password — no env var needed
  const noEnvVar = isDuckDb || connectionConfig?.type === 'bigquery';

  const lines: string[] = [
    `# Great Expectations (GX Core 1.x) — ${fqn}`,
    `# Generated by Data Quality Studio`,
    `#`,
    installLine(connectionConfig?.type),
    `#`,
    `# Usage:`,
    ...(noEnvVar
      ? [`#   python <this_file>.py`]
      : [
          `#   export DATABASE_URL="${connStr}"`,
          `#   python <this_file>.py`,
        ]
    ),
    ``,
    ...(noEnvVar ? [] : [`import os`]),
    `import great_expectations as gx`,
    ``,
    `context = gx.get_context()`,
    ``,
    `# ── Data source ─────────────────────────────────────────────────────────────`,
    ...(noEnvVar
      ? [`CONNECTION_STRING = "${connStr}"`]
      : [
          `# Replace YOUR_PASSWORD, or export DATABASE_URL to skip this line entirely`,
          `CONNECTION_STRING = os.environ.get("DATABASE_URL", "${connStr}")`,
        ]
    ),
    ``,
    `data_source = context.data_sources.add_sql(`,
    `    name="${dsName}",`,
    `    connection_string=CONNECTION_STRING,`,
    `)`,
    ...(isDuckDb
      ? [
          `asset = data_source.add_query_asset(`,
          `    name="${table.table}",`,
          `    query="${duckdbFileQuery(connectionConfig, table.table)}",`,
          `)`,
        ]
      : [
          `asset = data_source.add_table_asset(`,
          `    name="${table.table}",`,
          `    table_name="${table.table}",`,
          `    schema_name="${table.schema}",`,
          `)`,
        ]
    ),
    `batch_definition = asset.add_batch_definition_whole_table("${table.table}_full_table")`,
    ``,
    `# ── Expectation suite ───────────────────────────────────────────────────────`,
    `suite = context.suites.add(gx.ExpectationSuite(name="${suiteName}"))`,
    ``,
    `# ── Checks ──────────────────────────────────────────────────────────────────`,
  ];

  const byColumn = new Map<string, SelectedCheck[]>();
  for (const c of checks) {
    if (!byColumn.has(c.columnName)) byColumn.set(c.columnName, []);
    byColumn.get(c.columnName)!.push(c);
  }

  for (const [col, colChecks] of byColumn) {
    lines.push(`# ${col}`);
    for (const c of colChecks) lines.push(renderCheck(c));
    lines.push('');
  }

  for (const c of customChecks) {
    lines.push(`# ${c.columnName} — custom: ${c.name} (rows matching the condition fail)`);
    lines.push(renderCustom(c));
    lines.push('');
  }

  lines.push(
    `# ── Run validation ──────────────────────────────────────────────────────────`,
    `validation = context.validation_definitions.add(`,
    `    gx.ValidationDefinition(name="${valName}", data=batch_definition, suite=suite)`,
    `)`,
    `results = validation.run()`,
    `print(results)`,
    ``,
  );

  return lines.join('\n');
}
