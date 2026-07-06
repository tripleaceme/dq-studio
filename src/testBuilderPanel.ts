import * as vscode from 'vscode';
import { GE_CHECKS, SODA_CHECKS } from './checks/catalog';
import { generateGE } from './generators/geGenerator';
import { generateSoda } from './generators/sodaGenerator';
import { ConnectionConfig, CustomCheck, DataTypeCategory, Framework, GenerateRequest, SelectedCheck, TableInfo } from './types';

export class TestBuilderPanel {
  static instance: TestBuilderPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private connectionConfig: ConnectionConfig | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    const storedFramework = context.globalState.get<string>('dq-studio.framework') ?? null;
    this.panel.webview.html = this.buildHtml(storedFramework);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this), null, this.disposables);
  }

  static show(context: vscode.ExtensionContext): TestBuilderPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (TestBuilderPanel.instance) {
      TestBuilderPanel.instance.panel.reveal(column);
      return TestBuilderPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      'dqBuilder',
      'Data Quality Studio',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );
    TestBuilderPanel.instance = new TestBuilderPanel(panel, context.extensionUri, context);
    return TestBuilderPanel.instance;
  }

  loadTable(table: TableInfo) {
    this.panel.reveal();
    this.panel.webview.postMessage({ type: 'loadTable', table, dbType: this.connectionConfig?.type ?? null });
  }

  setConnection(config: ConnectionConfig) {
    this.connectionConfig = config;
  }

  private async handleMessage(message: {
    type: string;
    framework?: Framework;
    checks?: SelectedCheck[];
    customChecks?: CustomCheck[];
    table?: TableInfo;
    // check picker
    columnName?: string;
    columnCategory?: DataTypeCategory;
    existingCheckIds?: string[];
  }) {
    switch (message.type) {

      case 'frameworkChosen': {
        await this.context.globalState.update('dq-studio.framework', message.framework ?? undefined);
        break;
      }

      case 'generate': {
        if (!message.framework || !message.table) return;
        const req: GenerateRequest = {
          framework: message.framework,
          table: message.table,
          checks: message.checks ?? [],
          customChecks: message.customChecks ?? [],
          connectionConfig: this.connectionConfig,
        };
        const code = message.framework === 'soda' ? generateSoda(req) : generateGE(req);
        const lang = message.framework === 'soda' ? 'yaml' : 'python';
        const doc = await vscode.workspace.openTextDocument({ language: lang, content: code });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
        break;
      }

      case 'showWarning': {
        vscode.window.showWarningMessage((message as unknown as { text: string }).text);
        break;
      }

      case 'showCheckPicker': {
        const { columnName, columnCategory, framework, existingCheckIds = [] } = message as Required<typeof message>;
        if (!columnName || !columnCategory || !framework) return;

        const catalog = framework === 'soda' ? SODA_CHECKS : GE_CHECKS;
        type CheckItem = vscode.QuickPickItem & { checkId: string };

        const available: CheckItem[] = catalog
          .filter(d => (d.applies === 'all' || d.applies.includes(columnCategory)) && !existingCheckIds.includes(d.id))
          .map(d => ({ label: d.label, description: d.description, checkId: d.id }));

        const alreadyAdded: CheckItem[] = catalog
          .filter(d => existingCheckIds.includes(d.id))
          .map(d => ({ label: `$(check) ${d.label}`, description: '(already added)', checkId: d.id }));

        const items: CheckItem[] = [
          ...available,
          { label: '', kind: vscode.QuickPickItemKind.Separator, checkId: '' },
          { label: '$(edit) Custom check', description: 'Name + SQL fail condition, run in your warehouse', checkId: 'custom' },
          ...(alreadyAdded.length > 0 ? [
            { label: 'Already added', kind: vscode.QuickPickItemKind.Separator, checkId: '' },
            ...alreadyAdded,
          ] : []),
        ];

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Add check for ${columnName} (${columnCategory})`,
          matchOnDescription: true,
        });

        if (picked?.checkId) {
          this.panel.webview.postMessage({ type: 'checkPicked', columnName, checkId: picked.checkId });
        }
        break;
      }
    }
  }

  private buildHtml(storedFramework: string | null): string {
    const cspSource = this.panel.webview.cspSource;
    const catalog = JSON.stringify({ soda: SODA_CHECKS, ge: GE_CHECKS });
    const initialFramework = JSON.stringify(storedFramework);

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Quality Studio</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
    }

    /* ── Empty state ─────────────────────────────────── */
    #empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 60vh;
      gap: 12px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
    }
    #empty-state .icon { font-size: 48px; }

    /* ── Framework picker ────────────────────────────── */
    #framework-picker {
      display: none;
      flex-direction: column;
      gap: 16px;
    }
    .table-heading {
      font-size: 1.1em;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .table-heading span {
      font-weight: 400;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
    .picker-prompt {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
    .fw-buttons { display: flex; gap: 10px; }
    .fw-btn {
      padding: 10px 24px;
      border: 1px solid var(--vscode-button-border, var(--vscode-focusBorder));
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      border-radius: 4px;
      font-size: 0.95em;
      font-family: inherit;
      transition: background 0.15s;
    }
    .fw-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .fw-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }

    /* ── Builder ─────────────────────────────────────── */
    #builder { display: none; flex-direction: column; gap: 0; }

    .builder-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 16px;
    }
    .fw-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .switch-link {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: underline;
      background: none;
      border: none;
      font-family: inherit;
      font-size: inherit;
      padding: 0;
    }
    .switch-link:hover { color: var(--vscode-textLink-activeForeground); }

    /* ── Column card ─────────────────────────────────── */
    .col-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      margin-bottom: 10px;
      overflow: hidden;
    }
    .col-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--vscode-sideBar-background);
      cursor: pointer;
      user-select: none;
    }
    .col-header:hover { background: var(--vscode-list-hoverBackground); }
    .col-name { font-weight: 600; font-size: 0.95em; }
    .col-type {
      font-size: 0.75em;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-left: 8px;
    }
    .col-chevron { color: var(--vscode-descriptionForeground); transition: transform 0.2s; }
    .col-card.open .col-chevron { transform: rotate(90deg); }

    .col-body {
      display: none;
      padding: 10px 12px;
      flex-direction: column;
      gap: 6px;
      background: var(--vscode-editor-background);
    }
    .col-card.open .col-body { display: flex; }

    /* ── Check row ───────────────────────────────────── */
    .check-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
    }
    .check-row-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .check-label { font-size: 0.9em; font-weight: 500; }
    .check-desc { font-size: 0.78em; color: var(--vscode-descriptionForeground); margin-top: 1px; }
    .remove-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--vscode-errorForeground);
      font-size: 1.1em;
      padding: 0 4px;
      line-height: 1;
    }
    .remove-btn:hover { opacity: 0.7; }

    .param-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .param-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); min-width: 90px; }
    .param-input {
      flex: 1;
      min-width: 80px;
      padding: 3px 7px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
    }
    .param-input:focus { outline: 1px solid var(--vscode-focusBorder); }

    /* ── Custom check ────────────────────────────────── */
    .custom-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border: 1px dashed var(--vscode-focusBorder);
      border-radius: 4px;
      background: var(--vscode-input-background);
    }
    .custom-name-input, .custom-expr-input {
      width: 100%;
      padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
    }
    .custom-expr-input {
      resize: vertical;
      min-height: 52px;
      font-family: var(--vscode-editor-font-family);
    }
    .custom-name-input:focus, .custom-expr-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    .custom-field-label {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
    }

    /* ── Add check button ────────────────────────────── */
    .add-check-btn {
      width: 100%;
      padding: 5px 10px;
      background: none;
      border: 1px dashed var(--vscode-panel-border);
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      border-radius: 4px;
      font-family: inherit;
      font-size: 0.85em;
      text-align: left;
    }
    .add-check-btn:hover { background: var(--vscode-list-hoverBackground); }

    /* ── Generate button ─────────────────────────────── */
    .generate-wrap {
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
      margin-top: 8px;
    }
    .generate-btn {
      padding: 8px 20px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.95em;
      font-weight: 600;
    }
    .generate-btn:hover { background: var(--vscode-button-hoverBackground); }
    .generate-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .generate-hint {
      margin-top: 6px;
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>

<!-- ── Empty state ─────────────────────────────────────── -->
<div id="empty-state">
  <div class="icon">🗃</div>
  <div>Select a table from the <strong>Data Quality</strong> sidebar</div>
  <div style="font-size:0.85em">Schemas → Tables → click any table to begin</div>
</div>

<!-- ── Framework picker ────────────────────────────────── -->
<div id="framework-picker">
  <div class="table-heading" id="picker-table-name"></div>
  <div class="picker-prompt">Choose your testing framework — checks will be tailored to your selection:</div>
  <div class="fw-buttons">
    <button class="fw-btn" id="btn-soda" onclick="pickFramework('soda')">Soda Core</button>
    <button class="fw-btn" id="btn-ge" onclick="pickFramework('ge')">Great Expectations</button>
  </div>
</div>

<!-- ── Builder ──────────────────────────────────────────── -->
<div id="builder">
  <div class="builder-header">
    <div class="table-heading" id="builder-table-name"></div>
    <div class="fw-badge">
      <span id="fw-label"></span>
      <button class="switch-link" onclick="switchFramework()">Switch</button>
    </div>
  </div>
  <div id="columns-container"></div>
  <div class="generate-wrap">
    <button class="generate-btn" id="generate-btn" onclick="generate()">Generate Tests</button>
    <div class="generate-hint">Opens the generated code in a new editor tab — save it wherever you like.</div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();

  // Catalog injected from extension host
  const CATALOG = ${catalog};

  // App state — framework restored from previous session via globalState
  let state = {
    table: null,
    dbType: null,
    framework: ${initialFramework},
    checks: {},
    customChecks: {},
  };

  // ── Messages from extension ─────────────────────────────────────────────
  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'loadTable') {
      state.dbType = msg.dbType || null;
      loadTable(msg.table);
    } else if (msg.type === 'checkPicked') {
      const col = state.table && state.table.columns.find(c => c.name === msg.columnName);
      if (!col) return;
      if (msg.checkId === 'custom') {
        addCustomCheck(col);
      } else {
        const def = getCatalog().find(d => d.id === msg.checkId);
        if (def) addCheck(col, def);
      }
    }
  });

  function loadTable(table) {
    state.table = table;
    // Keep state.framework — framework is a one-time session choice, not per table
    state.checks = {};
    state.customChecks = {};

    if (state.framework) {
      // Framework already chosen — go straight to builder
      buildUI();
      show('builder');
    } else {
      // First table ever — show the framework picker once
      show('framework-picker');
      document.getElementById('picker-table-name').textContent =
        table.schema + '.' + table.table + ' (' + table.columns.length + ' columns)';
    }
  }

  function pickFramework(fw) {
    state.framework = fw;
    vscode.postMessage({ type: 'frameworkChosen', framework: fw });
    buildUI();
    show('builder');
  }

  function switchFramework() {
    state.checks = {};
    state.customChecks = {};
    state.framework = null;
    vscode.postMessage({ type: 'frameworkChosen', framework: null });
    if (state.table) {
      document.getElementById('picker-table-name').textContent =
        state.table.schema + '.' + state.table.table + ' (' + state.table.columns.length + ' columns)';
    }
    show('framework-picker');
  }

  function show(id) {
    ['empty-state','framework-picker','builder'].forEach(i => {
      document.getElementById(i).style.display = i === id
        ? (i === 'builder' || i === 'framework-picker' ? 'flex' : 'flex')
        : 'none';
    });
  }

  // ── Build column UI ────────────────────────────────────────────────────
  function buildUI() {
    const fw = state.framework;
    document.getElementById('fw-label').textContent =
      fw === 'soda' ? 'Soda Core' : 'Great Expectations';
    document.getElementById('builder-table-name').textContent =
      state.table.schema + '.' + state.table.table;

    const container = document.getElementById('columns-container');
    container.innerHTML = '';

    for (const col of state.table.columns) {
      if (!state.checks[col.name]) state.checks[col.name] = [];
      if (!state.customChecks[col.name]) state.customChecks[col.name] = [];
      container.appendChild(buildColumnCard(col));
    }
  }

  function buildColumnCard(col) {
    const card = document.createElement('div');
    card.className = 'col-card';
    card.id = 'card-' + col.name;

    // Header
    const header = document.createElement('div');
    header.className = 'col-header';
    header.innerHTML =
      '<div><span class="col-name">' + escHtml(col.name) + '</span>' +
      '<span class="col-type">' + escHtml(col.rawType) + '</span></div>' +
      '<span class="col-chevron">›</span>';
    header.addEventListener('click', () => {
      card.classList.toggle('open');
      renderChecks(col);
    });

    const body = document.createElement('div');
    body.className = 'col-body';
    body.id = 'body-' + col.name;

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  function renderChecks(col) {
    const body = document.getElementById('body-' + col.name);
    body.innerHTML = '';

    const checks = state.checks[col.name] || [];
    const customs = state.customChecks[col.name] || [];

    // Existing checks
    checks.forEach((chk, idx) => {
      const def = getCatalog().find(d => d.id === chk.checkId);
      if (!def) return;
      body.appendChild(buildCheckRow(col, chk, def, idx));
    });

    // Custom checks
    customs.forEach((c, idx) => {
      body.appendChild(buildCustomRow(col, c, idx));
    });

    // Add check button + dropdown
    const wrap = document.createElement('div');
    wrap.className = 'add-check-wrap';

    const btn = document.createElement('button');
    btn.className = 'add-check-btn';
    btn.textContent = '+ Add check';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const existingIds = (state.checks[col.name] || []).map(c => c.checkId);
      vscode.postMessage({
        type: 'showCheckPicker',
        columnName: col.name,
        columnCategory: col.category,
        framework: state.framework,
        existingCheckIds: existingIds,
      });
    });

    wrap.appendChild(btn);
    body.appendChild(wrap);
  }

  function buildCheckRow(col, chk, def, idx) {
    const row = document.createElement('div');
    row.className = 'check-row';

    const top = document.createElement('div');
    top.className = 'check-row-top';
    top.innerHTML =
      '<div><div class="check-label">' + escHtml(def.label) + '</div>' +
      '<div class="check-desc">' + escHtml(def.description) + '</div></div>';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove check';
    removeBtn.addEventListener('click', () => {
      state.checks[col.name].splice(idx, 1);
      renderChecks(col);
    });
    top.appendChild(removeBtn);
    row.appendChild(top);

    // Params
    for (const param of def.params) {
      const paramRow = document.createElement('div');
      paramRow.className = 'param-row';
      paramRow.innerHTML = '<span class="param-label">' + escHtml(param.label) + '</span>';

      const input = document.createElement('input');
      input.className = 'param-input';
      input.type = param.type === 'number' || param.type === 'percentage' ? 'number' : 'text';
      input.placeholder = param.placeholder || '';
      input.value = chk.params[param.name] || '';
      input.addEventListener('input', () => {
        chk.params[param.name] = input.value;
      });

      paramRow.appendChild(input);
      row.appendChild(paramRow);
    }

    return row;
  }

  function buildCustomRow(col, customChk, idx) {
    // Both frameworks take a SQL fail condition evaluated in the connected
    // warehouse: Soda as a failed-rows "fail condition", GE as an
    // UnexpectedRowsExpectation query. Rows matching the condition FAIL.
    const DIALECTS = { postgres: 'PostgreSQL', redshift: 'Redshift', snowflake: 'Snowflake', bigquery: 'BigQuery' };
    const dialect = DIALECTS[state.dbType] || 'your warehouse';
    const placeholder = 'e.g.  amount < 0 OR amount > 999999';

    const row = document.createElement('div');
    row.className = 'custom-row';

    const top = document.createElement('div');
    top.className = 'check-row-top';
    top.innerHTML = '<div class="check-label">Custom check</div>';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      state.customChecks[col.name].splice(idx, 1);
      renderChecks(col);
    });
    top.appendChild(removeBtn);
    row.appendChild(top);

    // Name field
    const nameLabel = document.createElement('div');
    nameLabel.className = 'custom-field-label';
    nameLabel.innerHTML = 'Name <span style="color:var(--vscode-errorForeground)">*</span>';
    row.appendChild(nameLabel);
    const nameInput = document.createElement('input');
    nameInput.className = 'custom-name-input';
    nameInput.placeholder = 'e.g. "Revenue cannot be negative"';
    nameInput.value = customChk.name || '';
    nameInput.addEventListener('input', () => {
      customChk.name = nameInput.value;
    });
    row.appendChild(nameInput);

    // Expression field
    const exprLabel = document.createElement('div');
    exprLabel.className = 'custom-field-label';
    exprLabel.textContent = 'Fail condition (' + dialect + ' SQL)';
    row.appendChild(exprLabel);

    const exprInput = document.createElement('textarea');
    exprInput.className = 'custom-expr-input';
    exprInput.title = 'SQL boolean expression run in ' + dialect + ' — rows matching this condition FAIL the check.';
    exprInput.placeholder = placeholder;
    exprInput.value = customChk.expression || '';
    exprInput.addEventListener('input', () => {
      customChk.expression = exprInput.value;
    });
    row.appendChild(exprInput);

    return row;
  }

  function addCheck(col, def) {
    if (!state.checks[col.name]) state.checks[col.name] = [];
    const params = {};
    for (const p of def.params) params[p.name] = '';
    state.checks[col.name].push({ checkId: def.id, params });
    const card = document.getElementById('card-' + col.name);
    if (!card.classList.contains('open')) card.classList.add('open');
    renderChecks(col);
  }

  function addCustomCheck(col) {
    if (!state.customChecks[col.name]) state.customChecks[col.name] = [];
    state.customChecks[col.name].push({ name: '', expression: '' });
    const card = document.getElementById('card-' + col.name);
    if (!card.classList.contains('open')) card.classList.add('open');
    renderChecks(col);
  }

  // ── Generate ──────────────────────────────────────────────────────────
  function generate() {
    const allChecks = [];
    const allCustom = [];

    for (const col of state.table.columns) {
      for (const c of (state.checks[col.name] || [])) {
        allChecks.push({ columnName: col.name, checkId: c.checkId, params: c.params });
      }
      for (const c of (state.customChecks[col.name] || [])) {
        if (!c.name.trim() || !c.expression.trim()) {
          vscode.postMessage({ type: 'showWarning', text: 'Every custom check needs both a Name and a condition. Please complete all custom checks first.' });
          return;
        }
        allCustom.push({ columnName: col.name, name: c.name, expression: c.expression });
      }
    }

    if (allChecks.length === 0 && allCustom.length === 0) {
      vscode.postMessage({ type: 'showWarning', text: 'No checks selected yet. Add at least one check before generating.' });
      return;
    }

    vscode.postMessage({
      type: 'generate',
      framework: state.framework,
      table: state.table,
      checks: allChecks,
      customChecks: allCustom,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function getCatalog() {
    return state.framework === 'soda' ? CATALOG.soda : CATALOG.ge;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
</script>
</body>
</html>`;
  }

  dispose() {
    TestBuilderPanel.instance = undefined;
    this.panel.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
