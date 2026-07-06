# Data Quality Studio — Great Expectations & Soda Core

> Build production-ready data quality tests visually, no memorising SodaCL or Great Expectations syntax.

Connect to your live database, browse schemas and tables directly in the VS Code sidebar, pick checks from a full catalog filtered to each column's data type, and generate ready-to-run **SodaCL YAML** or **Great Expectations Python** in one click.

---

## How It Works

### 1. Connect and browse your database

The extension auto-detects your credentials from `~/.dbt/profiles.yml` or a workspace `.env` file on startup. Your schemas and tables appear immediately in the **Data Quality** sidebar, no configuration required if you already have dbt set up.

![Sidebar tree and framework picker](media/schema-table-framework%20view.png)

Click any table to open the test builder panel.

---

### 2. Pick your framework — once per session

Choose **Soda Core** or **Great Expectations** the first time you open a table. The choice is remembered across VS Code and you will never be asked again unless you explicitly switch.

![Framework picker](media/select_framework.png)

Checks are tailored to the framework you pick. There is no mixing: Soda checks produce SodaCL YAML, GE checks produce Python.

---

### 3. Add checks per column

Every column is shown with its data type badge. Click a column to expand it and use **+ Add check** to open VS Code's native command palette, searchable, keyboard-navigable, and filtered to checks that apply to that column's type.

![Check builder with checks added per column](media/GE-choose-test-2.png)

Numeric columns get range checks (min, max, avg, sum, percentile). Text columns get length and regex checks. Timestamp columns get freshness and date-range checks. Booleans and categoricals get value-set checks. Every column gets null and uniqueness checks.

---

### 4. Generate — opens in a new editor tab

Click **Generate Tests**. The output opens in a new editor tab with the correct language mode already set (YAML for Soda, Python for GE). Save the file wherever your project expects it, there is no fixed output path.

![Generated GE Python alongside the builder](media/GE-fct_orders-test.png)

![Full generated GE Python file](media/GE-test-generated.png)

![Soda Core YAML with configuration hint](media/Soda-dim_channels-test.png)

---

## Features

- **Zero-config auto-connect:** Reads `~/.dbt/profiles.yml` (resolves `{{ env_var('...') }}` templates), workspace `.env`, or a custom path you set once in VS Code settings
- **Live schema browser:** schemas → tables loaded directly from your database; refresh any time with the ↺ button
- **One-time framework choice:** Pick Soda Core or Great Expectations once; the choice persists across sessions and across tables
- **Full check catalog:** 18 Soda checks + 17 GE checks, each filtered to the column data types they apply to:
  - Presence & validity — null, uniqueness, value sets, allowed values
  - Numeric statistics — min, max, average, sum, std dev, percentile, unique proportion
  - String patterns — regex match, length bounds, date format strings
  - Timestamps & freshness — freshness window, date min/max, parseable dates
- **VS Code-native check picker:** `+ Add check` opens the command palette at the top of the editor, not a clipped inline dropdown
- **Custom checks:** Write any check the catalog doesn't cover: give it a name and a **SQL fail condition** (rows matching it fail). The condition runs in your warehouse's own SQL dialect — shown in the field label — and generates a SodaCL failed-rows check or a GE `UnexpectedRowsExpectation` depending on your framework
- **Generated output uses your real connection details:** host, port, database, user, and schema are filled in; only the password stays as an environment variable placeholder
- **Framework-specific configuration hints:** Soda output includes a ready-to-fill `configuration.yml` block; GE output includes the correct `pip install` line and `DATABASE_URL` export command

---

## Supported Databases

| Database | Auto-detect | Manual |
|---|---|---|
| PostgreSQL | `~/.dbt/profiles.yml` · `.env` | Connection string |
| Redshift | `~/.dbt/profiles.yml` | Connection string |
| Snowflake | `~/.dbt/profiles.yml` | Browse for `profiles.yml` |
| BigQuery | `~/.dbt/profiles.yml` | Browse for service account JSON |

**Custom credentials path:** Set `dq-studio.credentialsPath` in VS Code Settings to point at any `profiles.yml`, BigQuery service account JSON, or `.env` file. The extension uses that path instead of the default lookup. Supports `~` for the home directory.

---

## Full Check Catalog

### Soda Core (SodaCL)

| Check | Applies to | What it generates |
|---|---|---|
| Missing (null) count | All | `missing_count(col) = 0` |
| Duplicate count | All | `duplicate_count(col) = 0` |
| Missing % threshold | All | `missing_percent(col) < N` |
| Duplicate % threshold | All | `duplicate_percent(col) < N` |
| Values in set | Text, Boolean | `invalid_count(col) = 0: valid values: [...]` |
| Min value ≥ | Numeric | `min(col) >= N` |
| Max value ≤ | Numeric | `max(col) <= N` |
| Average between | Numeric | `avg(col) between A and B` |
| Sum between | Numeric | `sum(col) between A and B` |
| Std dev between | Numeric | `stddev(col) between A and B` |
| Percentile value | Numeric | `percentile(col, P) between A and B` |
| Min string length | Text | `min_length(col) >= N` |
| Max string length | Text | `max_length(col) <= N` |
| Avg string length | Text | `avg_length(col) between A and B` |
| Freshness window | Timestamp | `freshness(col) < Xh` |
| Date minimum | Timestamp | `min(col) >= 'YYYY-MM-DD'` |
| Date maximum | Timestamp | `max(col) <= 'YYYY-MM-DD'` |
| **Custom check** | All | `failed rows: name: ..., fail condition: ...` |

### Great Expectations

| Check | Applies to | What it generates |
|---|---|---|
| Not Null | All | `expect_column_values_to_not_be_null` |
| Unique | All | `expect_column_values_to_be_unique` |
| Mostly not null (%) | All | `expect_column_values_to_not_be_null(mostly=N)` |
| Values in set | Text, Boolean | `expect_column_values_to_be_in_set` |
| Values not in set | Text, Boolean | `expect_column_values_to_not_be_in_set` |
| Unique proportion | All | `expect_column_proportion_of_unique_values_to_be_between` |
| Min value between | Numeric | `expect_column_min_to_be_between` |
| Max value between | Numeric | `expect_column_max_to_be_between` |
| Mean between | Numeric | `expect_column_mean_to_be_between` |
| Sum between | Numeric | `expect_column_sum_to_be_between` |
| Std dev between | Numeric | `expect_column_stdev_to_be_between` |
| Quantile value | Numeric | `expect_column_quantile_values_to_be_between` |
| String length between | Text | `expect_column_value_lengths_to_be_between` |
| Regex match | Text | `expect_column_values_to_match_regex` |
| Date format (strftime) | Text, Timestamp | `expect_column_values_to_match_strftime_format` |
| Date parseable | Timestamp | `expect_column_values_to_be_dateutil_parseable` |
| Date range | Timestamp | `expect_column_values_to_be_between` |
| **Custom check** | All | `UnexpectedRowsExpectation` — `SELECT * FROM {batch} WHERE <fail condition>` in native SQL |

---

## Generated Output

### Soda Core

```yaml
# Soda Core — checks file
# Generated by Data Quality Studio
#
# 1. Install:  pip install soda-core-postgres
#
# 2. Save the following as configuration.yml:
#
#   data_sources:
#     raw_data:
#       type: postgres
#       connection:
#         host: prod.db.example.com
#         port: 5432
#         database: warehouse
#       username: analytics_user
#       password: ${DB_PASSWORD}
#       schema: raw_data
#
# 3. Run:
#      soda scan -d raw_data -c configuration.yml checks.yml

checks for raw_data.order_items:
  # order_item_id
  - duplicate_count(order_item_id) = 0
  - missing_count(order_item_id) = 0
  # amount_usd
  - min(amount_usd) >= 0
  - max(amount_usd) <= 99999
  - missing_count(amount_usd) = 0
  # status
  - invalid_count(status) = 0:
      valid values: ['pending', 'shipped', 'delivered', 'returned']
  # custom check
  - failed rows:
      name: Amount cannot be negative
      fail condition: amount_usd < 0
```

### Great Expectations

```python
# Great Expectations (GX Core 1.x) — raw_data.order_items
# Generated by Data Quality Studio
#
# pip install 'great_expectations[postgresql]'
#
# Usage:
#   export DATABASE_URL="postgresql+psycopg2://analytics_user:YOUR_PASSWORD@prod.db.example.com:5432/warehouse"
#   python <this_file>.py

import os
import great_expectations as gx

context = gx.get_context()

# ── Data source ─────────────────────────────────────────────────────────────
# Replace YOUR_PASSWORD, or export DATABASE_URL to skip this line entirely
CONNECTION_STRING = os.environ.get("DATABASE_URL", "postgresql+psycopg2://analytics_user:YOUR_PASSWORD@prod.db.example.com:5432/warehouse")

data_source = context.data_sources.add_sql(
    name="raw_data_datasource",
    connection_string=CONNECTION_STRING,
)
asset = data_source.add_table_asset(
    name="order_items",
    table_name="order_items",
    schema_name="raw_data",
)
batch_definition = asset.add_batch_definition_whole_table("order_items_full_table")

# ── Expectation suite ───────────────────────────────────────────────────────
suite = context.suites.add(gx.ExpectationSuite(name="order_items_suite"))

# ── Checks ──────────────────────────────────────────────────────────────────
# order_item_id
suite.add_expectation(gx.expectations.ExpectColumnValuesToBeUnique(column="order_item_id"))
suite.add_expectation(gx.expectations.ExpectColumnValuesToNotBeNull(column="order_item_id"))

# amount_usd
suite.add_expectation(gx.expectations.ExpectColumnMinToBeBetween(column="amount_usd", min_value=0, max_value=0))
suite.add_expectation(gx.expectations.ExpectColumnMaxToBeBetween(column="amount_usd", min_value=0, max_value=99999))

# amount_usd — custom: Amount cannot be negative (rows matching the condition fail)
suite.add_expectation(gx.expectations.UnexpectedRowsExpectation(
    unexpected_rows_query="SELECT * FROM {batch} WHERE amount_usd < 0",
    description="Amount cannot be negative",
))

# ── Run validation ──────────────────────────────────────────────────────────
validation = context.validation_definitions.add(
    gx.ValidationDefinition(name="order_items_validation", data=batch_definition, suite=suite)
)
results = validation.run()
print(results)
```

---

## Connection Setup

### Auto-detect (no configuration needed)

On startup the extension tries the following in order:

1. The path set in `dq-studio.credentialsPath` (if configured)
2. `~/.dbt/profiles.yml` — reads your active target and resolves `{{ env_var('VAR') }}` templates against your shell environment
3. A `.env` file in the open workspace root (looks for `DB_HOST`, `DB_USER`, `DB_NAME` and variants)

If a connection is found, the sidebar tree populates automatically.

### Manual connection

Click the **⚙** icon in the Data Quality sidebar title bar. You can:

- **Use an auto-detected connection** if one was found, confirm or browse for a different file
- **Browse for a credentials file:** opens a file picker defaulting to `~/.dbt/`
  - `profiles.yml` or `.yaml` — dbt profile format, all targets supported
  - `.env` — key=value format with standard `DB_HOST` / `POSTGRES_*` / `DATABASE_*` variable names
- **Paste a connection string:** `postgresql://user:password@host:5432/database`
- **Select a BigQuery service account JSON:** standard `{"type": "service_account", "project_id": ...}` format

### Persistent credentials path

Set `dq-studio.credentialsPath` in VS Code Settings (or `settings.json`) to avoid browsing each time:

```json
{
  "dq-studio.credentialsPath": "~/.dbt/profiles.yml"
}
```

Supports `~` for the home directory. Accepts `profiles.yml`, service account JSON, or `.env` files.

---

## Requirements

- **VS Code** 1.85 or later
- A running **PostgreSQL, Redshift, Snowflake, or BigQuery** database accessible from your machine
- **Python** with `great_expectations` (GX Core 1.x) or `soda-core-*` installed, only needed to *run* the generated tests, not to use the extension itself

---

## Privacy

The extension connects only to the database you configure. No data, queries, or schema information is sent anywhere other than your own database server.

---

## License

MIT — see [LICENSE](LICENSE)
