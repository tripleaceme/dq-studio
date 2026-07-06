import * as fs from 'fs';
import * as vscode from 'vscode';
import { detectConnection, promptForConnection } from './connectionDetector';
import { DbClient } from './dbClient';
import { SchemaTreeProvider } from './schemaTreeProvider';
import { TestBuilderPanel } from './testBuilderPanel';
import { ColumnInfo, ConnectionConfig } from './types';

const LOCAL_FILES_KEY = 'dq-studio.localFiles';
const LAST_TYPE_KEY   = 'dq-studio.lastConnectionType';

let dbClient: DbClient | null = null;
let treeProvider: SchemaTreeProvider;
let extContext: vscode.ExtensionContext;

// Restore a previous local-files session; files that no longer exist are dropped
function savedLocalFilesConfig(): ConnectionConfig | null {
  const files = (extContext.globalState.get<string[]>(LOCAL_FILES_KEY) ?? []).filter(f => fs.existsSync(f));
  return files.length > 0 ? { type: 'duckdb', files, database: 'local files' } : null;
}

export async function activate(context: vscode.ExtensionContext) {
  extContext = context;
  treeProvider = new SchemaTreeProvider();

  const treeView = vscode.window.createTreeView('dq-schema-tree', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Auto-detect on startup. If the last session used local files, restore that
  // selection; otherwise try ~/.dbt/profiles.yml / .env, then fall back to files.
  const preferFiles = context.globalState.get<string>(LAST_TYPE_KEY) === 'duckdb';
  const config = (preferFiles ? savedLocalFilesConfig() : null)
    ?? await detectConnection()
    ?? savedLocalFilesConfig();
  if (config) {
    await connectWithConfig(config);
  } else {
    treeProvider.setError('No credentials found. Click ⚙ to select your profiles.yml, credentials file, or local CSV/Parquet files.');
  }

  // Command: open table in webview
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'dq-builder.openTable',
      async (schema: string, table: string) => {
        if (!dbClient) {
          vscode.window.showErrorMessage('No database connection. Use ⚙ to configure one.');
          return;
        }
        const panel = TestBuilderPanel.show(context);
        if (dbClient) panel.setConnection(dbClient.connectionConfig);
        const columns: ColumnInfo[] = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Loading ${schema}.${table}…`,
            cancellable: false,
          },
          () => dbClient!.getColumns(schema, table)
        );
        panel.loadTable({ schema, table, columns });
      }
    )
  );

  // Command: refresh tree
  context.subscriptions.push(
    vscode.commands.registerCommand('dq-builder.refreshTree', () => {
      treeProvider.refresh();
    })
  );

  // Command: configure connection
  context.subscriptions.push(
    vscode.commands.registerCommand('dq-builder.configureConnection', async () => {
      // First try auto-detect; if nothing found, fall through to the manual picker
      let config: ConnectionConfig | null = await detectConnection();
      if (!config) {
        config = await promptForConnection();
      } else {
        // Connection found — ask whether to use it or pick a different one
        const use = await vscode.window.showQuickPick(
          [
            { label: `$(check) Use auto-detected connection (${config.type})`, value: 'use' },
            { label: '$(folder-opened) Browse for a different credentials file', value: 'browse' },
          ],
          { placeHolder: 'Connection detected' }
        );
        if (!use) return;
        if (use.value === 'browse') config = await promptForConnection();
      }
      if (config) await connectWithConfig(config);
    })
  );

  context.subscriptions.push(treeView);
}

async function connectWithConfig(config: ConnectionConfig) {
  const client = new DbClient(config);
  try {
    await client.testConnection();
    dbClient = client;
    treeProvider.setClient(dbClient);
    TestBuilderPanel.instance?.setConnection(config);

    // Remember what worked so the next session restores it without prompting
    await extContext.globalState.update(LAST_TYPE_KEY, config.type);
    if (config.type === 'duckdb' && config.files) {
      await extContext.globalState.update(LOCAL_FILES_KEY, config.files);
    }

    const target = config.type === 'duckdb'
      ? `${config.files?.length ?? 0} local file${(config.files?.length ?? 0) === 1 ? '' : 's'}`
      : config.database;
    vscode.window.setStatusBarMessage(
      `$(database) DQ Studio connected to ${target}`,
      5000
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    treeProvider.setError(`Cannot connect: ${msg}`);

    // Timeouts and refused connections are transient — don't prompt to change credentials
    const isAuthError = /auth|password|credential|SASL|permission|denied|login|invalid/i.test(msg);
    if (isAuthError) {
      const action = await vscode.window.showErrorMessage(
        `DQ Builder: connection failed: ${msg}`,
        'Select credentials file'
      );
      if (action === 'Select credentials file') {
        const newConfig = await promptForConnection();
        if (newConfig) await connectWithConfig(newConfig);
      }
    } else {
      vscode.window.showErrorMessage(`DQ Builder: connection failed: ${msg}`);
    }
  }
}

export function deactivate() {}
