# Changelog

## [0.2.2] — 2026-07-06

### Fixed
- **GE custom checks generated a non-existent API** — the output called `expect_column_values_to_satisfy(condition_parser="pandas", ...)`, which does not exist in Great Expectations (core or contrib) and would raise `AttributeError` at runtime; `condition_parser="pandas"` is also invalid on SQL data sources. Custom checks now generate `gx.expectations.UnexpectedRowsExpectation(unexpected_rows_query="SELECT * FROM {batch} WHERE <fail condition>")`, which runs natively in the connected warehouse — the same failed-rows semantics Soda uses
- **Quote escaping in generated GE Python** — custom check names and conditions containing `"` or `\` no longer produce a Python syntax error

### Changed
- **Custom check UI unified to one SQL fail condition** — no more pandas syntax for GE vs SodaCL for Soda. Both frameworks take a SQL boolean expression (rows matching it fail); the field label shows the connected warehouse's dialect, e.g. `Fail condition (Snowflake SQL)`. The execution engine is auto-derived from the active connection — no engine dropdown needed, since generated tests always run against the connected SQL warehouse
- **GE generator migrated to GX Core 1.x API** — `context.sources.add_or_update_sql`, `get_validator`, and validator-based checkpoints were removed in GX 1.0, and `pip install great_expectations` installs 1.x today. Generated scripts now use `context.data_sources.add_sql`, `suite.add_expectation(gx.expectations.*)` classes, whole-table batch definitions, and `ValidationDefinition.run()`; install hints use GX extras (e.g. `pip install 'great_expectations[postgresql]'`)
- **Rebranded remaining "DQ Test Builder" strings to Data Quality Studio** — panel title, generated file headers, and the settings section now match the Marketplace listing

---

## [0.2.1] — 2026-05-23

### Fixed
- **Switch framework button broken** — VS Code webviews suppress `window.confirm()` (always returns `false`), so the switch was silently blocked. Removed the confirm dialog; switching now works immediately and re-shows the framework picker for the current table
- **`alert()` calls replaced** — validation warnings (incomplete custom checks, no checks added) now appear as VS Code native warning messages instead of the no-op `window.alert()`
- **Framework picker table name missing on switch** — `picker-table-name` was only set in `loadTable()`; now also updated when `switchFramework()` is called so the table name is visible in the picker

---

## [0.2.0] — 2026-05-23

### Added
- **Snowflake and BigQuery support** — full adapter support alongside PostgreSQL and Redshift; auto-detected from `~/.dbt/profiles.yml`
- **Custom credentials path** — set `dq-test-builder.credentialsPath` in VS Code Settings to any `profiles.yml`, BigQuery service account JSON, or `.env` file
- **Framework choice persisted across sessions** — Soda Core / GE selection is stored in VS Code global state and restored on next launch; the picker is shown only once
- **VS Code native check picker** — `+ Add check` now opens the command palette at the top of the editor (searchable, keyboard-navigable) instead of an inline dropdown
- **Real connection values in generated output** — generated GE Python and Soda YAML include the actual host, port, database, and user from the active session; only the password remains as an env var placeholder
- **`DATABASE_URL` convention for GE output** — single connection string env var instead of separate host/port/user variables; set it once, all generated files pick it up
- **Soda `configuration.yml` block** — generated Soda YAML includes a ready-to-fill `configuration.yml` snippet and the correct `soda-core-*` package for the connected DB type
- **GE checkpoint and run block** — generated GE Python now includes the full datasource setup, `add_or_update_checkpoint`, and `checkpoint.run()` so the file is executable as-is
- **`{{ env_var('VAR') }}` resolution** — dbt profiles using environment variable templates are resolved against the current shell environment before connecting

### Fixed
- **SASL authentication error** — `pg` client requires password as a string; `undefined` now coerced to `''` to prevent SCRAM handshake failure
- **Hardcoded schema defaults removed** — `|| 'public'` and `|| 'PUBLIC'` overrides stripped; the schema from the profile is used exactly as written
- **Custom check remove button** — `row.innerHTML +=` was destroying the event listener on the × button; replaced with `createElement` + `appendChild`
- **Connection timeout no longer prompts for credentials** — transient errors (timeout, ECONNREFUSED) show only the error message; the "Select credentials file" action is reserved for auth failures
- **File picker defaults to `~/.dbt/`** — opening the credentials browser now starts at the dbt directory instead of the system root
- **`dbt_project.yml` guard** — selecting the project file instead of `profiles.yml` now shows a clear error explaining the difference

---

## [0.1.0] — 2026-05-22

### Added
- Sidebar tree view: auto-detects PostgreSQL connection from dbt `profiles.yml` or `.env`
- Framework picker: choose between **Soda Core** or **Great Expectations** per session
- Full check catalog: 18 Soda checks + 17 GE checks, filtered per column data type
- Custom check support: name + condition fields, with per-framework syntax hints
- Code generation: outputs SodaCL YAML or GE Python directly into a new editor tab
- One-click connection string fallback for projects without dbt
