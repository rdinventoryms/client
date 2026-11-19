const ROOT_NAME = 'Inventory Management System';
const COLUMNS = {
  Settings: ['Key', 'Value'],
  Parts: ['ID', 'SKU', 'Part', 'On hand', 'Low threshold', 'Revision', 'Supplier name', 'Stock value centavos'],
  Packages: ['ID', 'Package', 'Description', 'Price centavos', 'Recipe JSON', 'Photo file', 'Revision', 'Deleted UTC'],
  Orders: ['Order ID', 'Submitted UTC', 'Customer', 'Email', 'Phone', 'Address', 'Notes',
    'Currency', 'Total centavos', 'Packages JSON', 'Components deducted JSON', 'Request ID', 'Status', 'Revision', 'Deleted UTC'],
  Purchases: ['Purchase ID', 'Recorded UTC', 'Part ID', 'SKU', 'Part', 'Supplier name', 'Purchase type',
    'Quantity purchased', 'Total centavos', 'Unit cost centavos', 'Stock before receipt',
    'Value before receipt centavos', 'Stock after receipt', 'Value after receipt centavos',
    'Weighted average centavos', 'Request ID'],
};
const HEX = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL = 21600;
const ORDER_STATUSES = ['Order Placed', 'Assembling', 'Delivery', 'Fulfilled'];

function doGet(e) {
  const title = (PropertiesService.getScriptProperties().getProperty('APP_PAGE_TITLE') || '').trim() || ROOT_NAME;
  const page = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  if (e && e.parameter && e.parameter.embed === '1') {
    page.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return page;
}

function action(name, token, data) {
  try {
    if (name === 'systemSignIn') return { ok: true, data: { email: verifyOperator_(), users: systemUsers_() } };
    if (name === 'systemProvision') {
      verifyOperator_();
      return { ok: true, data: locked_(() => provisionTenant_(data.email, data.storeName)) };
    }
    if (name === 'systemRevealKey') {
      verifyOperator_();
      return { ok: true, data: locked_(() => revealOwnerKey_(requireWorkspace_(data.id))) };
    }
    if (name === 'systemReplaceKey') {
      verifyOperator_();
      return { ok: true, data: locked_(() => {
        const tenant = requireWorkspace_(data.id);
        return issueOwnerKey_(tenant, Boolean(tenant.digest));
      }) };
    }
    if (name === 'signIn') return { ok: true, data: signIn_(data && data.key) };
    if (name === 'start') {
      if (token) return { ok: true, data: { token, ...dashboard_(tenantFor_(token)) } };
      const tenant = operatorTenant_();
      return { ok: true, data: tenant ? newSession_(tenant) : null };
    }
    const tenant = tenantFor_(token);
    switch (name) {
      case 'signOut':
        CacheService.getScriptCache().remove('session:' + digest_(token));
        return { ok: true };
      case 'dashboard': return { ok: true, data: dashboard_(tenant) };
      case 'asset': return { ok: true, data: readAsset_(tenant, data) };
      case 'savePart': return { ok: true, data: locked_(() => savePart_(tenant, data)) };
      case 'editPartInfo': return { ok: true, data: locked_(() => editPartInfo_(tenant, data)) };
      case 'restockPart': return { ok: true, data: locked_(() => restockPart_(tenant, data)) };
      case 'setPartOpeningCost': return { ok: true, data: locked_(() => setPartOpeningCost_(tenant, data)) };
      case 'purchaseHistory': return { ok: true, data: purchaseHistory_(tenant, data.id) };
      case 'savePackage': return { ok: true, data: locked_(() => savePackage_(tenant, data)) };
      case 'deletePackage': return { ok: true, data: locked_(() => deletePackage_(tenant, data)) };
      case 'saveBrand': return { ok: true, data: locked_(() => saveBrand_(tenant, data)) };
      case 'submitOrder': return { ok: true, data: locked_(() => submitOrder_(tenant, data)) };
      case 'orders': return { ok: true, data: listOrders_(tenant) };
      case 'updateOrder': return { ok: true, data: locked_(() => updateOrder_(tenant, data)) };
      case 'deleteOrder': return { ok: true, data: locked_(() => deleteOrder_(tenant, data)) };
      default: fail_('Action unavailable.');
    }
  } catch (error) {
    if (error.name === 'InventoryError') return { ok: false, error: error.message, code: error.code };
    console.error(error.stack || String(error));
    return { ok: false, error: 'Google Drive or Sheets could not complete this request. Please try again.' };
  }
}

function verifyOperator_() {
  const active = Session.getActiveUser().getEmail().toLowerCase();
  const effective = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!active || active !== effective) fail_('Sign in to Google as the deploying account to open the system owner portal.', 'AUTH');
  return effective;
}

// Run in the Apps Script editor as the deploying account.
function setupOperator() {
  const email = verifyOperator_();
  return locked_(() => {
    const props = PropertiesService.getScriptProperties();
    const existing = props.getProperty('OPERATOR_TENANT');
    if (existing) {
      const tenant = readTenant_(existing);
      console.log('Inventory Sheet: https://docs.google.com/spreadsheets/d/' + tenant.sheetId + '/edit');
      return;
    }
    if (!EMAIL.test(email)) fail_('Google did not provide your email address.');
    const tenant = createTenant_(email, props.getProperty('INITIAL_BRAND_NAME') || 'Remourà');
    props.setProperty('OPERATOR_TENANT', tenant.id);
    console.log('Inventory Sheet: https://docs.google.com/spreadsheets/d/' + tenant.sheetId + '/edit');
  });
}

// Set NEXT_OWNER_EMAIL and NEXT_BRAND_NAME in Script Properties, then run in the editor.
function provisionOwner() {
  verifyOperator_();
  return locked_(() => {
    const props = PropertiesService.getScriptProperties();
    const user = provisionTenant_(props.getProperty('NEXT_OWNER_EMAIL'), props.getProperty('NEXT_BRAND_NAME'));
    props.deleteProperty('NEXT_OWNER_EMAIL');
    props.deleteProperty('NEXT_BRAND_NAME');
    console.log('Workspace created. Open the system owner portal to view its access key. ID: ' + user.id);
  });
}

// Set ROTATE_TENANT_ID to the ID before the period in an owner's access key.
function rotateOwnerKey() {
  verifyOperator_();
  return locked_(() => {
    const props = PropertiesService.getScriptProperties();
    const tenant = requireWorkspace_(props.getProperty('ROTATE_TENANT_ID'));
    issueOwnerKey_(tenant, true);
    props.deleteProperty('ROTATE_TENANT_ID');
    console.log('Access key replaced. View the new key in the system owner portal.');
  });
}

function root_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ROOT_FOLDER');
  if (id) return id;
  const folder = Drive.Files.create({ name: ROOT_NAME, mimeType: 'application/vnd.google-apps.folder' });
  props.setProperty('ROOT_FOLDER', folder.id);
  return folder.id;
}

function createTenant_(email, rawBrand) {
  const brand = text_(rawBrand, 'brand name', 80);
  const id = Utilities.getUuid();
  const folder = Drive.Files.create({ name: brand + ' · ' + id.slice(0, 8),
    mimeType: 'application/vnd.google-apps.folder', parents: [root_()] });
  const file = Drive.Files.create({ name: brand + ' Inventory', mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: [folder.id] });
  const sheet = book_(file.id);
  const settingsId = sheet.tabs[0].sheetId;
  const defaultSettings = Object.entries({
    storeName: brand, accent: '#785032', background: '#faf6ed', ink: '#2d241e', logo: '', backdrop: '',
  });
  const requests = Object.entries(COLUMNS).flatMap(([title, headers], index) => {
    const sheetId = index === 0 ? settingsId : settingsId + index;
    const properties = { sheetId, title, gridProperties: { frozenRowCount: 1 } };
    const configure = index === 0
      ? { updateSheetProperties: { properties, fields: 'title,gridProperties.frozenRowCount' } }
      : { addSheet: { properties } };
    const rows = title === 'Settings' ? [headers, ...defaultSettings] : [headers];
    return [configure, update_(sheetId, 0, 0, rows), { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length },
      cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold',
    } }];
  });
  write_(sheet, requests);
  const tenant = { id, email, brand, digest: '', folderId: folder.id, sheetId: file.id, generation: 1,
    purchaseSchema: 1, orderSchema: 1, packageSchema: 1 };
  PropertiesService.getScriptProperties().setProperty('tenant:' + id, JSON.stringify(tenant));
  return tenant;
}

function readTenant_(id) {
  const raw = UUID.test(String(id)) && PropertiesService.getScriptProperties().getProperty('tenant:' + id);
  return raw ? JSON.parse(raw) : null;
}

function requireWorkspace_(id) {
  const tenant = readTenant_(id);
  if (!tenant) fail_('Workspace not found.');
  return tenant;
}

function systemUsers_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(properties).filter(key => key.startsWith('tenant:') && UUID.test(key.slice(7)))
    .map(key => {
      const tenant = JSON.parse(properties[key]);
      let storeName = tenant.brand;
      try {
        const savedName = settings_({ id: tenant.sheetId }).storeName;
        if (typeof savedName === 'string' && savedName.trim()) storeName = savedName;
      } catch {
        console.warn('Could not read a workspace display name.');
      }
      return { id: tenant.id, email: tenant.email, storeName,
        keyStatus: tenant.keyNonce ? 'ready' : tenant.digest ? 'legacy' : 'none' };
    }).sort((a, b) => a.storeName.localeCompare(b.storeName));
}

function provisionTenant_(emailValue, nameValue) {
  const email = text_(emailValue, 'email address', 254).toLowerCase();
  const storeName = text_(nameValue, 'store name', 80);
  if (!EMAIL.test(email)) fail_('Enter a valid email address.');
  if (systemUsers_().some(user => user.email === email && user.storeName.toLowerCase() === storeName.toLowerCase())) {
    fail_('This email already has a workspace with that store name.');
  }
  const tenant = createTenant_(email, storeName);
  issueOwnerKey_(tenant, false);
  return { id: tenant.id, email, storeName, keyStatus: 'ready' };
}

function deriveOwnerSecret_(tenant, master) {
  const input = 'owner-access:v1:' + [tenant.id, tenant.generation, tenant.keyNonce].join(':');
  return Utilities.computeHmacSha256Signature(input, master)
    .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
}

function issueOwnerKey_(tenant, replace) {
  const props = PropertiesService.getScriptProperties();
  let master = props.getProperty('OWNER_KEY_MASTER_V1');
  if (!master) {
    master = randomToken_();
    props.setProperty('OWNER_KEY_MASTER_V1', master);
  }
  if (replace) tenant.generation += 1;
  tenant.keyNonce = Utilities.getUuid();
  const secret = deriveOwnerSecret_(tenant, master);
  tenant.digest = digest_(secret);
  props.setProperty('tenant:' + tenant.id, JSON.stringify(tenant));
  return tenant.id + '.' + secret;
}

function revealOwnerKey_(tenant) {
  const master = PropertiesService.getScriptProperties().getProperty('OWNER_KEY_MASTER_V1');
  if (!master || !tenant.keyNonce) fail_('This key cannot be revealed. Issue a replacement from the portal.');
  const secret = deriveOwnerSecret_(tenant, master);
  if (!equal_(tenant.digest, digest_(secret))) fail_('This key cannot be revealed. Issue a replacement from the portal.');
  return tenant.id + '.' + secret;
}

function operatorTenant_() {
  const active = Session.getActiveUser().getEmail().toLowerCase();
  const effective = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!active || active !== effective) return null;
  const id = PropertiesService.getScriptProperties().getProperty('OPERATOR_TENANT');
  const tenant = readTenant_(id);
  return tenant && tenant.email === active ? tenant : null;
}

function signIn_(accessKey) {
  const value = typeof accessKey === 'string' && accessKey.trim();
  if (!value || value.length !== 101) fail_('Invalid owner access key.', 'AUTH');
  const [id, secret] = value.split('.');
  const tenant = readTenant_(id);
  if (!/^[0-9a-f]{64}$/.test(secret) || !tenant?.digest || !equal_(tenant.digest, digest_(secret))) {
    fail_('Invalid owner access key.', 'AUTH');
  }
  return newSession_(tenant);
}

function newSession_(tenant) {
  ensureWorkspaceSchema_(tenant);
  const token = randomToken_();
  CacheService.getScriptCache().put('session:' + digest_(token), JSON.stringify([tenant.id, tenant.generation]), SESSION_TTL);
  return { token, ...dashboard_(tenant) };
}

function tenantFor_(token) {
  const cache = CacheService.getScriptCache();
  const raw = /^[0-9a-f]{64}$/.test(String(token)) && cache.get('session:' + digest_(token));
  if (raw) {
    const [id, generation] = JSON.parse(raw);
    const tenant = readTenant_(id);
    if (tenant?.generation === generation) {
      ensureWorkspaceSchema_(tenant);
      return tenant;
    }
  }
  fail_('Your session ended. Sign in again.', 'AUTH');
}

const randomToken_ = () => (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
const digest_ = value => Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));

function equal_(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function locked_(work) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('Inventory is busy. Try again in a moment.', 'BUSY');
  try { return work(); } finally { lock.releaseLock(); }
}

function fail_(message, code = 'INVALID') {
  const error = new Error(message);
  error.name = 'InventoryError';
  error.code = code;
  throw error;
}

function text_(value, label, max, required = true) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if ((required && !clean) || clean.length > max) fail_('Enter a valid ' + label + '.');
  return clean;
}

function integer_(value, label, max, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail_(label + ' must be a whole number from ' + min + ' to ' + max + '.');
  }
  return value;
}

function book_(id) {
  const result = Sheets.Spreadsheets.get(id, { fields: 'sheets(properties(sheetId,title))' });
  const tabs = result.sheets.map(sheet => sheet.properties);
  return { id, tabs, tab: title => tabs.find(tab => tab.title === title).sheetId };
}

function values_(sheet, range) {
  return Sheets.Spreadsheets.Values.get(sheet.id, range, { valueRenderOption: 'UNFORMATTED_VALUE' }).values || [];
}

function rows_(sheet, name) {
  const end = String.fromCharCode(64 + COLUMNS[name].length);
  return values_(sheet, name + '!A2:' + end);
}

function cell_(value) {
  return { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value ?? '') } };
}

const cellRows_ = values => values.map(row => ({ values: row.map(cell_) }));
const append_ = (sheetId, values) => ({ appendCells: { sheetId, rows: cellRows_(values), fields: 'userEnteredValue' } });
const update_ = (sheetId, rowIndex, columnIndex, values) => ({ updateCells: {
  start: { sheetId, rowIndex, columnIndex },
  rows: cellRows_(values), fields: 'userEnteredValue',
} });

function write_(sheet, requests) {
  Sheets.Spreadsheets.batchUpdate({ requests }, sheet.id);
}

function ensureWorkspaceSchema_(tenant) {
  if (tenant.purchaseSchema === 1 && tenant.orderSchema === 1 && tenant.packageSchema === 1) return;
  locked_(() => {
    const current = readTenant_(tenant.id);
    if (current.purchaseSchema === 1 && current.orderSchema === 1 && current.packageSchema === 1) return;
    const sheet = book_(current.sheetId);
    const requests = [];
    if (current.purchaseSchema !== 1) {
      if (!sheet.tabs.some(tab => tab.title === 'Purchases')) {
        const sheetId = Math.max(...sheet.tabs.map(tab => tab.sheetId)) + 1;
        requests.push({ addSheet: { properties: { title: 'Purchases', sheetId, gridProperties: { frozenRowCount: 1 } } } },
          update_(sheetId, 0, 0, [COLUMNS.Purchases]));
      }
      requests.push(update_(sheet.tab('Parts'), 0, 6, [COLUMNS.Parts.slice(6)]));
    }
    if (current.orderSchema !== 1) requests.push(update_(sheet.tab('Orders'), 0, 12, [COLUMNS.Orders.slice(12)]));
    if (current.packageSchema !== 1) requests.push(update_(sheet.tab('Packages'), 0, 7, [COLUMNS.Packages.slice(7)]));
    write_(sheet, requests);
    current.purchaseSchema = 1;
    current.orderSchema = 1;
    current.packageSchema = 1;
    PropertiesService.getScriptProperties().setProperty('tenant:' + current.id, JSON.stringify(current));
  });
}

function parts_(sheet) {
  return rows_(sheet, 'Parts').map(([id, sku, name, stock, threshold, revision, supplier, value], index) => {
    const stockValue = stock === 0 ? 0 : Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { id, sku, name, stock, threshold, revision, supplier: supplier || '', stockValue,
      averageCost: stock > 0 && stockValue !== null ? stockValue / stock : null, index: index + 1 };
  }).filter(part => part.id);
}

function packages_(sheet, includeDeleted = false) {
  return rows_(sheet, 'Packages').map(([id, name, description, price, recipe, photo, revision, deleted], index) =>
    ({ id, name, description, price, recipe: id ? JSON.parse(recipe) : [], photo, revision, deleted, index: index + 1 }))
    .filter(kit => kit.id && (includeDeleted || !kit.deleted));
}

function settings_(sheet) {
  return Object.fromEntries(rows_(sheet, 'Settings').filter(([key]) => key));
}

function packageStatus_(kit, partMap) {
  const components = kit.recipe.map(({ id, quantity }) => ({
    id, quantity, name: partMap.get(id)?.name || 'Missing part (' + id + ')', stock: partMap.get(id)?.stock ?? 0,
  }));
  const available = components.length ? Math.min(...components.map(part => Math.floor(part.stock / part.quantity))) : 0;
  const { index, recipe, photo, deleted, ...fields } = kit;
  return { ...fields, components, available, missing: components.filter(part => part.stock < part.quantity), hasPhoto: Boolean(photo) };
}

function dashboard_(tenant) {
  const sheet = book_(tenant.sheetId);
  const settings = settings_(sheet);
  const parts = parts_(sheet);
  const partMap = new Map(parts.map(part => [part.id, part]));
  return {
    tenantId: tenant.id,
    brand: { storeName: settings.storeName || tenant.brand, accent: settings.accent, background: settings.background,
      ink: settings.ink, hasLogo: Boolean(settings.logo), hasBackdrop: Boolean(settings.backdrop) },
    parts: parts.map(({ index, ...part }) => part),
    packages: packages_(sheet).map(kit => packageStatus_(kit, partMap)),
  };
}

function prorate_(value, stock, quantity) {
  if (!quantity) return 0;
  if (value === null || !stock) return null;
  return Math.floor(value / stock) * quantity + Math.round((value % stock) * quantity / stock);
}

function purchase_(data) {
  if (!data || !['Bulk', 'Per Item'].includes(data.type)) fail_('Choose Bulk or Per Item.');
  if (!UUID.test(String(data.key))) fail_('Invalid purchase reference.');
  const quantity = integer_(data.quantity, 'Purchase quantity', 1000000, 1);
  const price = integer_(data.price, 'Purchase price in centavos', data.type === 'Bulk' ? 1000000000000000 : 1000000000);
  const value = data.type === 'Bulk' ? price : price * quantity;
  return { type: data.type, key: data.key, quantity, value, unitCost: value / quantity };
}

function savePart_(tenant, data) {
  if (data.id) fail_('Refresh the app and choose Edit Part Info or Restock.');
  if (data.purchase) fail_('Add the part first, then use Restock to log a purchase.');
  const sheet = book_(tenant.sheetId);
  const supplier = text_(data.supplier, 'supplier name', 120, false);
  const sku = generateSku_(settings_(sheet).storeName || tenant.brand, parts_(sheet));
  const name = text_(data.name, 'part name', 100);
  const stock = integer_(data.stock, 'On hand', 1000000);
  const threshold = integer_(data.threshold, 'Low-stock threshold', 1000000);
  const stockValue = !stock ? 0 : data.openingCost == null ? null : openingValue_(data.openingCost, stock);
  writePart_(sheet, { id: Utilities.getUuid(), sku, name, stock, threshold, supplier, stockValue, revision: 0 }, null);
  return dashboard_(tenant);
}

function generateSku_(brand, parts) {
  const words = brand.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().match(/[A-Z0-9]+/g) || [];
  const prefix = words.length > 1 ? words.slice(0, 3).map(word => word[0]).join('') : (words[0] || 'SKU').slice(0, 3);
  const used = new Set(parts.map(part => String(part.sku).toUpperCase()));
  for (let attempt = 0; attempt < 10; attempt++) {
    const sku = prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 9).toUpperCase();
    if (!used.has(sku)) return sku;
  }
  fail_('A unique SKU could not be generated. Please try again.');
}

function currentPart_(sheet, data) {
  const part = parts_(sheet).find(item => item.id === data.id);
  if (!part || part.revision !== data.revision) fail_('The part changed. Reopen it and try again.', 'STALE');
  return part;
}

function editPartInfo_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const part = currentPart_(sheet, data);
  const stock = integer_(data.stock, 'On hand', 1000000);
  writePart_(sheet, {
    ...part,
    name: text_(data.name, 'part name', 100),
    threshold: integer_(data.threshold, 'Low-stock threshold', 1000000),
    stock, stockValue: prorate_(part.stockValue, part.stock, stock),
  }, null);
  return dashboard_(tenant);
}

function restockPart_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const receipt = purchase_(data.purchase);
  if (receiptExists_(sheet, receipt.key)) return dashboard_(tenant);
  writePart_(sheet, currentPart_(sheet, data), receipt);
  return dashboard_(tenant);
}

function setPartOpeningCost_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const part = currentPart_(sheet, data);
  if (!part.stock || part.stockValue !== null) fail_('Only existing stock without a recorded value needs an opening cost.');
  writePart_(sheet, { ...part, stockValue: openingValue_(data.openingCost, part.stock) }, null);
  return dashboard_(tenant);
}

function openingValue_(unitCost, stock) {
  return integer_(unitCost, 'Opening unit cost in centavos', 1000000000) * stock;
}

function receiptExists_(sheet, key) {
  return values_(sheet, 'Purchases!P2:P').some(([existing]) => existing === key);
}

function writePart_(sheet, part, receipt) {
  const { id, sku, name, supplier, threshold, revision, index, stock: before, stockValue: beforeValue } = part;
  if (receipt && beforeValue === null) fail_('Set an opening unit cost for the remaining stock before restocking.');
  const stock = integer_(before + (receipt?.quantity || 0), 'Resulting stock', 1000000);
  const value = receipt ? beforeValue + receipt.value : beforeValue;
  if (value !== null) integer_(value, 'Resulting stock value in centavos', 1000000000000000);
  const tab = sheet.tab('Parts');
  const row = [id, sku, name, stock, threshold, revision + 1, supplier, value ?? ''];
  const requests = [index ? update_(tab, index, 0, [row]) : append_(tab, [row])];
  if (receipt) requests.push(append_(sheet.tab('Purchases'), [[Utilities.getUuid(), new Date().toISOString(),
    id, sku, name, supplier, receipt.type, receipt.quantity, receipt.value, receipt.unitCost, before, beforeValue,
    stock, value, value / stock, receipt.key]]));
  write_(sheet, requests);
}

function purchaseHistory_(tenant, id) {
  if (!UUID.test(String(id))) fail_('Invalid part.');
  const sheet = book_(tenant.sheetId);
  if (!parts_(sheet).some(part => part.id === id)) fail_('Part not found.');
  return rows_(sheet, 'Purchases').filter(row => row[2] === id).slice(-100).reverse().map(row => ({
    date: row[1], supplier: row[5] || 'Supplier not recorded', type: row[6] === 'Per Piece' ? 'Per Item' : row[6],
    quantity: row[7], total: row[8], unitCost: row[9],
    averageCost: row[14],
  }));
}

function savePackage_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const tab = sheet.tab('Packages');
  const previous = packages_(sheet).find(kit => kit.id === data.id);
  if (data.id && (!previous || previous.revision !== data.revision)) fail_('The package changed. Reopen it and try again.', 'STALE');
  if (!Array.isArray(data.components) || data.components.length < 1 || data.components.length > 40) fail_('Choose 1 to 40 components.');
  const partIds = new Set(parts_(sheet).map(part => part.id));
  const seen = new Set();
  const recipe = data.components.map(({ id, quantity }) => {
    if (!partIds.has(id) || seen.has(id)) fail_('Choose a different inventory part for each component.');
    seen.add(id);
    return { id, quantity: integer_(quantity, 'Component quantity', 999, 1) };
  });
  const row = [previous?.id || Utilities.getUuid(), text_(data.name, 'package name', 120),
    text_(data.description, 'description', 450, false), integer_(data.price, 'Price in centavos', 1000000000), JSON.stringify(recipe),
    previous?.photo || '', (previous?.revision || 0) + 1];
  if (data.photo) row[5] = createImage_(tenant, data.photo, 'package');
  if (data.removePhoto) row[5] = '';
  write_(sheet, [previous ? update_(tab, previous.index, 0, [row]) : append_(tab, [row])]);
  return dashboard_(tenant);
}

function deletePackage_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const kit = packages_(sheet, true).find(item => item.id === data.id);
  if (!kit || (!kit.deleted && kit.revision !== data.revision)) {
    fail_('The package changed. Refresh your packages and try again.', 'STALE');
  }
  if (!kit.deleted) {
    write_(sheet, [update_(sheet.tab('Packages'), kit.index, 6, [[kit.revision + 1, new Date().toISOString()]])]);
  }
  return dashboard_(tenant);
}

function saveBrand_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const tab = sheet.tab('Settings');
  const brand = settings_(sheet);
  brand.storeName = text_(data.storeName, 'store name', 80);
  for (const field of ['accent', 'background', 'ink']) {
    if (!HEX.test(String(data[field]))) fail_('Choose a valid color.');
    brand[field] = data[field];
  }
  for (const field of ['logo', 'backdrop']) {
    if (data[field]) brand[field] = createImage_(tenant, data[field], field);
    else if (data['remove' + field]) brand[field] = '';
  }
  write_(sheet, [update_(tab, 1, 0, Object.entries(brand))]);
  return dashboard_(tenant);
}

function createImage_(tenant, file, label) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!extension || typeof file.base64 !== 'string' || file.base64.length > 1400000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)) {
    fail_('Choose a JPEG, PNG, or WebP image up to 1 MB.');
  }
  const bytes = Utilities.base64Decode(file.base64);
  const signature = (...expected) => expected.every((value, index) => (bytes[index] & 255) === value);
  const valid = extension === 'jpg' ? signature(255, 216, 255) : extension === 'png' ? signature(137, 80, 78, 71, 13, 10, 26, 10)
    : signature(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!valid || bytes.length > 1048576) fail_('Choose a valid image up to 1 MB.');
  const blob = Utilities.newBlob(bytes, file.type, label + '-' + Utilities.getUuid() + '.' + extension);
  return Drive.Files.create({ name: blob.getName(), mimeType: file.type, parents: [tenant.folderId] }, blob).id;
}

function readAsset_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const id = data.kind === 'package' ? packages_(sheet).find(kit => kit.id === data.id)?.photo
    : ['logo', 'backdrop'].includes(data.kind) ? settings_(sheet)[data.kind] : null;
  if (!id) return null;
  const file = Drive.Files.get(id, { fields: 'parents,mimeType,size,trashed' });
  if (file.trashed || !file.parents?.includes(tenant.folderId) ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType) || Number(file.size) > 1048576) fail_('Image unavailable.');
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, followRedirects: false,
  });
  return 'data:' + file.mimeType + ';base64,' + Utilities.base64Encode(response.getContent());
}

function orderRecords_(sheet) {
  return rows_(sheet, 'Orders').flatMap(([id, created, customer, email, phone, address, notes, currency, total,
    lines, deductions, key, status, revision, deleted], row) => id ? [{
      id, created, customer, email, phone, address, notes, currency, total,
      lines: JSON.parse(lines || '[]'), deductions: JSON.parse(deductions || '[]'), key,
      status: status || ORDER_STATUSES[0], revision: revision || 1, deleted: deleted || '', index: row + 1,
    }] : []);
}

function listOrders_(tenant) {
  return orderRecords_(book_(tenant.sheetId)).reverse().filter(order => !order.deleted)
    .map(({ deductions, key, index, deleted, ...order }) => order);
}

function orderDetails_(data) {
  const customer = text_(data.customer, 'customer name', 120);
  const email = text_(data.email, 'customer email', 254, false);
  const phone = text_(data.phone, 'phone number', 60, false);
  if (email && !EMAIL.test(email)) fail_('Enter a valid customer email.');
  if (!email && !phone) fail_('Enter a customer email or phone number.');
  const status = data.status ?? ORDER_STATUSES[0];
  if (!ORDER_STATUSES.includes(status)) fail_('Choose a valid order status.');
  return { customer, email, phone, status, address: text_(data.address, 'address', 600, false),
    notes: text_(data.notes, 'order notes', 500, false) };
}

function orderLines_(data) {
  if (!Array.isArray(data.lines) || data.lines.length < 1 || data.lines.length > 40) fail_('Choose 1 to 40 packages.');
  const seen = new Set();
  return data.lines.map(line => {
    if (!line || !UUID.test(String(line.id)) || seen.has(line.id)) fail_('Choose a different package for each row.');
    seen.add(line.id);
    return { id: line.id, revision: line.revision, quantity: integer_(line.quantity, 'Package quantity', 99, 1) };
  });
}

function prepareOrder_(sheet, selected, previous = []) {
  const packages = new Map(packages_(sheet, previous.length > 0).map(kit => [kit.id, kit]));
  const original = new Map(previous.map(line => [line.id, line]));
  const required = new Map();
  let total = 0;
  const lines = selected.map(({ id, revision, quantity }) => {
    const kit = packages.get(id);
    const old = original.get(id);
    if (!kit || (kit.deleted ? !old || quantity > old.quantity : revision !== kit.revision)) {
      fail_('A package changed or is unavailable. Reopen the order and try again.', 'STALE');
    }
    const price = old?.price ?? kit.price;
    total += price * quantity;
    for (const component of kit.recipe) {
      required.set(component.id, (required.get(component.id) || 0) + component.quantity * quantity);
    }
    return { id, name: kit.name, price, quantity };
  });
  return { lines, total, required };
}

function balanceOrderStock_(sheet, prior, required) {
  const parts = new Map(parts_(sheet).map(part => [part.id, part]));
  const previous = new Map(prior.map(item => [item.id, item]));
  const tab = sheet.tab('Parts');
  const deductions = [];
  const requests = [];
  for (const id of new Set([...required.keys(), ...previous.keys()])) {
    const part = parts.get(id);
    const old = previous.get(id);
    const quantity = required.get(id) || 0;
    const oldQuantity = old?.quantity || 0;
    const oldCost = oldQuantity ? (Number.isSafeInteger(old.cost) ? old.cost : null) : 0;
    const change = quantity - oldQuantity;
    let cost = oldCost;
    if (change) {
      if (!part) fail_('An order component is missing from inventory.', 'STALE');
      if (part.stock < change) {
        fail_(part.name + ' needs ' + change + ' more units. ' + part.stock + ' are on hand.', 'STALE');
      }
      const stock = integer_(part.stock - change, 'Resulting stock', 1000000);
      const consumed = change > 0
        ? prorate_(part.stockValue, part.stock, change)
        : oldCost === null ? null : -prorate_(oldCost, oldQuantity, -change);
      cost = oldCost === null || consumed === null ? null : oldCost + consumed;
      const value = stock === 0 ? 0 : consumed === null || part.stockValue === null
        ? null : part.stockValue - consumed;
      if (value !== null) integer_(value, 'Resulting stock value in centavos', 1000000000000000);
      requests.push(update_(tab, part.index, 3, [[stock, part.threshold, part.revision + 1, part.supplier, value ?? '']]));
    }
    if (quantity) deductions.push({ id, name: part?.name || old?.name || 'Missing part', quantity, cost });
  }
  return { requests, deductions };
}

function orderCells_(order) {
  return [order.id, order.created, order.customer, order.email || '', order.phone || '', order.address || '',
    order.notes || '', order.currency, order.total, JSON.stringify(order.lines), JSON.stringify(order.deductions),
    order.key, order.status, order.revision, order.deleted || ''];
}

function existingOrder_(sheet, data) {
  const order = orderRecords_(sheet).find(record => record.id === data.id);
  if (!order || (!order.deleted && order.revision !== data.revision)) {
    fail_('The order changed. Refresh Orders and try again.', 'STALE');
  }
  return order;
}

function submitOrder_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  if (!UUID.test(String(data.key))) fail_('Invalid order reference.');
  const duplicate = orderRecords_(sheet).find(order => order.key === data.key);
  if (duplicate) {
    if (duplicate.deleted) fail_('This order was already deleted.');
    return { id: duplicate.id, total: duplicate.total, dashboard: dashboard_(tenant) };
  }
  const details = orderDetails_(data);
  const { lines, total, required } = prepareOrder_(sheet, orderLines_(data));
  const { requests, deductions } = balanceOrderStock_(sheet, [], required);
  const order = { ...details, id: Utilities.getUuid(), created: new Date().toISOString(), currency: 'PHP',
    key: data.key, revision: 1, lines, total, deductions };
  requests.push(append_(sheet.tab('Orders'), [orderCells_(order)]));
  write_(sheet, requests);
  return { id: order.id, total, dashboard: dashboard_(tenant) };
}

function updateOrder_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const old = existingOrder_(sheet, data);
  if (old.deleted) fail_('This order was already deleted.', 'STALE');
  const order = { ...old, ...orderDetails_(data), revision: old.revision + 1 };
  const lines = orderLines_(data);
  const quantities = new Map(old.lines.map(line => [line.id, line.quantity]));
  const unchanged = lines.length === old.lines.length && lines.every(line => quantities.get(line.id) === line.quantity);
  let requests = [];
  if (!unchanged) {
    const updated = prepareOrder_(sheet, lines, old.lines);
    const balance = balanceOrderStock_(sheet, old.deductions, updated.required);
    Object.assign(order, { lines: updated.lines, total: updated.total, deductions: balance.deductions });
    requests = balance.requests;
  }
  requests.push(update_(sheet.tab('Orders'), old.index, 0, [orderCells_(order)]));
  write_(sheet, requests);
  return dashboard_(tenant);
}

function deleteOrder_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const order = existingOrder_(sheet, data);
  if (order.deleted) return dashboard_(tenant);
  const { requests } = balanceOrderStock_(sheet, order.deductions, new Map());
  requests.push(update_(sheet.tab('Orders'), order.index, 13, [[order.revision + 1, new Date().toISOString()]]));
  write_(sheet, requests);
  return dashboard_(tenant);
}
