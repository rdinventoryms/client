const ROOT_NAME = 'Inventory Management System';
const COLUMNS = {
  Settings: ['Key', 'Value'],
  Parts: ['ID', 'SKU', 'Part', 'On hand', 'Low threshold', 'Revision', 'Supplier name', 'Stock value centavos'],
  Packages: ['ID', 'Package', 'Description', 'Price centavos', 'Recipe JSON', 'Photo file', 'Revision'],
  Orders: ['Order ID', 'Submitted UTC', 'Customer', 'Email', 'Phone', 'Address', 'Notes',
    'Currency', 'Total centavos', 'Packages JSON', 'Components deducted JSON', 'Request ID'],
  Purchases: ['Purchase ID', 'Recorded UTC', 'Part ID', 'SKU', 'Part', 'Supplier name', 'Purchase type',
    'Quantity purchased', 'Total centavos', 'Unit cost centavos', 'Stock before receipt',
    'Value before receipt centavos', 'Stock after receipt', 'Value after receipt centavos',
    'Weighted average centavos', 'Request ID'],
};
const HEX = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL = 21600;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Inventory Management System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function action(name, token, data) {
  try {
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
      case 'purchaseHistory': return { ok: true, data: purchaseHistory_(tenant, data.id) };
      case 'savePackage': return { ok: true, data: locked_(() => savePackage_(tenant, data)) };
      case 'saveBrand': return { ok: true, data: locked_(() => saveBrand_(tenant, data)) };
      case 'submitOrder': return { ok: true, data: locked_(() => submitOrder_(tenant, data)) };
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
  if (!active || active !== effective) fail_('Only the deploying Google account can manage workspaces.', 'AUTH');
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
    const tenant = createTenant_(email, props.getProperty('INITIAL_BRAND_NAME') || 'Remourà', '');
    props.setProperty('OPERATOR_TENANT', tenant.id);
    console.log('Inventory Sheet: https://docs.google.com/spreadsheets/d/' + tenant.sheetId + '/edit');
  });
}

// Set NEXT_OWNER_EMAIL and NEXT_BRAND_NAME in Script Properties, then run in the editor.
function provisionOwner() {
  verifyOperator_();
  return locked_(() => {
    const props = PropertiesService.getScriptProperties();
    const email = text_(props.getProperty('NEXT_OWNER_EMAIL'), 'owner email', 254).toLowerCase();
    const brand = text_(props.getProperty('NEXT_BRAND_NAME'), 'brand name', 80);
    if (!EMAIL.test(email)) fail_('Enter a valid owner email.');
    const secret = randomToken_();
    const tenant = createTenant_(email, brand, digest_(secret));
    props.deleteProperty('NEXT_OWNER_EMAIL');
    props.deleteProperty('NEXT_BRAND_NAME');
    console.log('Owner access key for ' + brand + ': ' + tenant.id + '.' + secret);
  });
}

// Set ROTATE_TENANT_ID to the ID before the period in an owner's access key.
function rotateOwnerKey() {
  verifyOperator_();
  return locked_(() => {
    const props = PropertiesService.getScriptProperties();
    const tenant = readTenant_(props.getProperty('ROTATE_TENANT_ID'));
    if (!tenant) fail_('Unknown workspace.');
    const secret = randomToken_();
    tenant.digest = digest_(secret);
    tenant.generation += 1;
    props.setProperty('tenant:' + tenant.id, JSON.stringify(tenant));
    props.deleteProperty('ROTATE_TENANT_ID');
    console.log('Replacement owner access key: ' + tenant.id + '.' + secret);
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

function createTenant_(email, rawBrand, digest) {
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
  const tenant = { id, email, brand, digest, folderId: folder.id, sheetId: file.id, generation: 1, purchaseSchema: 1 };
  PropertiesService.getScriptProperties().setProperty('tenant:' + id, JSON.stringify(tenant));
  return tenant;
}

function readTenant_(id) {
  const raw = UUID.test(String(id)) && PropertiesService.getScriptProperties().getProperty('tenant:' + id);
  return raw ? JSON.parse(raw) : null;
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
  ensurePurchaseSchema_(tenant);
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
      ensurePurchaseSchema_(tenant);
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

function ensurePurchaseSchema_(tenant) {
  if (tenant.purchaseSchema === 1) return;
  locked_(() => {
    const current = readTenant_(tenant.id);
    if (current.purchaseSchema === 1) return;
    const sheet = book_(current.sheetId);
    const existing = sheet.tabs.find(tab => tab.title === 'Purchases');
    const sheetId = existing?.sheetId ?? Math.max(...sheet.tabs.map(tab => tab.sheetId)) + 1;
    const requests = existing ? [] : [
      { addSheet: { properties: { title: 'Purchases', sheetId, gridProperties: { frozenRowCount: 1 } } } },
      update_(sheetId, 0, 0, [COLUMNS.Purchases]),
    ];
    requests.push(update_(sheet.tab('Parts'), 0, 6, [COLUMNS.Parts.slice(6)]));
    write_(sheet, requests);
    current.purchaseSchema = 1;
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

function packages_(sheet) {
  return rows_(sheet, 'Packages').map(([id, name, description, price, recipe, photo, revision], index) =>
    ({ id, name, description, price, recipe: id ? JSON.parse(recipe) : [], photo, revision, index: index + 1 })).filter(kit => kit.id);
}

function settings_(sheet) {
  return Object.fromEntries(rows_(sheet, 'Settings').filter(([key]) => key));
}

function packageStatus_(kit, partMap) {
  const components = kit.recipe.map(({ id, quantity }) => ({
    id, quantity, name: partMap.get(id)?.name || 'Missing part (' + id + ')', stock: partMap.get(id)?.stock ?? 0,
  }));
  const available = components.length ? Math.min(...components.map(part => Math.floor(part.stock / part.quantity))) : 0;
  const { index, recipe, photo, ...fields } = kit;
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

function purchase_(data, supplier) {
  if (!data) return null;
  if (!UUID.test(String(data.key))) fail_('Invalid purchase reference.');
  if (!supplier) fail_('Enter a supplier name for the purchase.');
  if (!['Bulk', 'Per Piece'].includes(data.type)) fail_('Choose Bulk or Per Piece.');
  const quantity = integer_(data.quantity, 'Purchase quantity', 1000000, 1);
  const price = integer_(data.price, 'Purchase price in centavos', data.type === 'Bulk' ? 1000000000000000 : 1000000000);
  const value = data.type === 'Bulk' ? price : price * quantity;
  return { type: data.type, key: data.key, quantity, value, unitCost: value / quantity };
}

function savePart_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  const tab = sheet.tab('Parts');
  const supplier = text_(data.supplier, 'supplier name', 120, false);
  const receipt = purchase_(data.purchase, supplier);
  if (receipt && values_(sheet, 'Purchases!P2:P').some(([key]) => key === receipt.key)) {
    return dashboard_(tenant);
  }
  const records = parts_(sheet);
  const previous = records.find(part => part.id === data.id);
  if (data.id && (!previous || previous.revision !== data.revision)) fail_('The part changed. Reopen it and try again.', 'STALE');
  const sku = text_(data.sku, 'SKU', 40).toUpperCase();
  if (records.some(part => part.sku === sku && part.id !== data.id)) fail_('This SKU is already in use.');
  const name = text_(data.name, 'part name', 100);
  const id = previous?.id || Utilities.getUuid();
  const before = integer_(data.stock, 'On hand before purchase', 1000000);
  const threshold = integer_(data.threshold, 'Low-stock threshold', 1000000);
  let beforeValue = prorate_(previous?.stockValue ?? null, previous?.stock ?? 0, before);
  if (before && beforeValue === null && data.openingCost != null) {
    beforeValue = integer_(data.openingCost, 'Opening unit cost in centavos', 1000000000) * before;
  }
  if (receipt && beforeValue === null) fail_('Enter the opening unit cost for the remaining stock before logging a purchase.');
  const stock = integer_(before + (receipt?.quantity || 0), 'Resulting stock', 1000000);
  const value = receipt ? beforeValue + receipt.value : beforeValue;
  if (value !== null) integer_(value, 'Resulting stock value in centavos', 1000000000000000);
  const row = [id, sku, name, stock, threshold, (previous?.revision || 0) + 1, supplier, value ?? ''];
  const requests = [previous ? update_(tab, previous.index, 0, [row]) : append_(tab, [row])];
  if (receipt) requests.push(append_(sheet.tab('Purchases'), [[Utilities.getUuid(), new Date().toISOString(),
    id, sku, name, supplier, receipt.type, receipt.quantity, receipt.value, receipt.unitCost, before, beforeValue,
    stock, value, value / stock, receipt.key]]));
  write_(sheet, requests);
  return dashboard_(tenant);
}

function purchaseHistory_(tenant, id) {
  if (!UUID.test(String(id))) fail_('Invalid part.');
  const sheet = book_(tenant.sheetId);
  if (!parts_(sheet).some(part => part.id === id)) fail_('Part not found.');
  return rows_(sheet, 'Purchases').filter(row => row[2] === id).slice(-100).reverse().map(row => ({
    date: row[1], supplier: row[5], type: row[6], quantity: row[7], total: row[8], unitCost: row[9],
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

function submitOrder_(tenant, data) {
  const sheet = book_(tenant.sheetId);
  if (!UUID.test(String(data.key))) fail_('Invalid order reference.');
  const duplicate = values_(sheet, 'Orders!L2:L').findIndex(([key]) => key === data.key);
  if (duplicate >= 0) {
    const rowNumber = duplicate + 2;
    const [row] = values_(sheet, 'Orders!A' + rowNumber + ':I' + rowNumber);
    return { id: row[0], total: row[8], dashboard: dashboard_(tenant) };
  }
  const customer = text_(data.customer, 'customer name', 120);
  const email = text_(data.email, 'customer email', 254, false);
  const phone = text_(data.phone, 'phone number', 60, false);
  if (email && !EMAIL.test(email)) fail_('Enter a valid customer email.');
  if (!email && !phone) fail_('Enter a customer email or phone number.');
  const address = text_(data.address, 'address', 600, false);
  const notes = text_(data.notes, 'order notes', 500, false);
  if (!Array.isArray(data.lines) || data.lines.length < 1 || data.lines.length > 40) fail_('Choose 1 to 40 packages.');
  const packages = new Map(packages_(sheet).map(kit => [kit.id, kit]));
  const parts = new Map(parts_(sheet).map(part => [part.id, part]));
  const used = new Map();
  const seen = new Set();
  let total = 0;
  const lines = data.lines.map(line => {
    const kit = packages.get(line.id);
    if (!kit || seen.has(line.id)) fail_('A package in the cart is unavailable.', 'STALE');
    if (line.revision !== kit.revision) fail_('A package changed. Review the cart and submit again.', 'STALE');
    seen.add(line.id);
    const quantity = integer_(line.quantity, 'Package quantity', 99, 1);
    total += kit.price * quantity;
    for (const entry of kit.recipe) used.set(entry.id, (used.get(entry.id) || 0) + entry.quantity * quantity);
    return { id: kit.id, name: kit.name, price: kit.price, quantity };
  });
  const deductions = [...used].map(([id, quantity]) => {
    const part = parts.get(id);
    if (!part || part.stock < quantity) {
      fail_((part?.name || 'A recipe component') + ' needs ' + quantity + ' units. ' +
        (part?.stock ?? 0) + ' are on hand.', 'STALE');
    }
    return { id, name: part.name, quantity, cost: prorate_(part.stockValue, part.stock, quantity) };
  });
  const tab = sheet.tab('Parts');
  const requests = deductions.map(({ id, quantity, cost }) => {
    const part = parts.get(id);
    const remaining = part.stock - quantity;
    const value = remaining === 0 ? 0 : cost === null ? '' : part.stockValue - cost;
    return update_(tab, part.index, 3, [[remaining, part.threshold, part.revision + 1, part.supplier, value]]);
  });
  const id = Utilities.getUuid();
  requests.push(append_(sheet.tab('Orders'), [[id, new Date().toISOString(), customer, email, phone, address, notes, 'PHP',
    total, JSON.stringify(lines), JSON.stringify(deductions), data.key]]));
  write_(sheet, requests);
  return { id, total, dashboard: dashboard_(tenant) };
}
