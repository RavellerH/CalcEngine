/* Central state definition & mutation helpers.
   Exposes a factory `createAppState()` and mutation functions that operate
   on a given state object. All calculation logic lives in calculations.js;
   this module only owns shape and CRUD. */

function createAppState() {
  return {
    version: APP_VERSION,
    meta: {
      app: APP_NAME,
      exported_at: null,
      author: '',
    },
    project: defaultProject(),
    config: defaultConfig(),
    pillars: emptyPillars(),
    cached_totals: {
      hardware: 0,
      software: 0,
      installation: 0,
      human_resources: 0,
      taxable_base: 0,
      ppn: 0,
      grand_total: 0,
    },
    catalog: [],
    dirty: false,
  };
}

function rowDefaults(pillar) {
  switch (pillar) {
    case 'hardware':
      return {
        id: newId('row-hw'),
        catalog_id: null,
        name: 'New Hardware Item',
        description: '',
        unit: 'pcs',
        quantity: 1,
        currency: 'IDR',
        unit_cost: 0,
        margin_pct: 0.2,
        annual_maintenance_pct_per_year: 0.1,
        taxable_ppn: true,
        source: '',
        procurement_type: 'Local',
        tags: [],
      };
    case 'software':
      return {
        id: newId('row-sw'),
        catalog_id: null,
        type: 'one_time',
        name: 'New Software Item',
        description: '',
        unit: 'lump_sum',
        quantity: 1,
        period_months: 12,
        seats: 1,
        currency: 'IDR',
        unit_cost: 0,
        margin_pct: 0.2,
        taxable_ppn: true,
      };
    case 'installation':
      return {
        id: newId('row-inst'),
        catalog_id: null,
        name: 'New Installation Item',
        description: '',
        unit: 'lump_sum',
        quantity: 1,
        currency: 'IDR',
        unit_cost: 0,
        margin_pct: 0,
        taxable_ppn: true,
        category: 'logistics',
        location: '',
      };
    case 'human_resources':
      return {
        id: newId('row-hr'),
        catalog_id: null,
        role: 'New Role',
        rate_basis: 'person_month',
        regulatory_source: 'Custom',
        reference_code: '',
        region_coefficient: null,
        duration_months: 1,
        duration_days: null,
        currency: 'IDR',
        rate_per_month: 0,
        rate_per_day: null,
        override_rate: false,
        custom_rate: null,
        taxable_ppn: false,
      };
    default:
      throw new Error(`Unknown pillar: ${pillar}`);
  }
}

function addRow(state, pillar, overrides = {}) {
  const row = { ...rowDefaults(pillar), ...overrides };
  state.pillars[pillar].items.push(row);
  state.dirty = true;
  return row;
}

function addRowFromCatalogItem(state, pillar, catalogItem) {
  const base = rowDefaults(pillar);
  const overrides = {
    catalog_id: catalogItem.id,
    name: catalogItem.name,
    description: catalogItem.description || '',
    unit: catalogItem.unit || base.unit,
    currency: catalogItem.currency || base.currency,
    unit_cost: catalogItem.unit_cost || 0,
    taxable_ppn: catalogItem.taxable_ppn ?? base.taxable_ppn,
  };
  if (pillar === 'hardware') {
    overrides.margin_pct = catalogItem.default_margin_pct ?? base.margin_pct;
    overrides.annual_maintenance_pct_per_year =
      catalogItem.default_maintenance_pct_per_year ?? base.annual_maintenance_pct_per_year;
    overrides.source = catalogItem.source || '';
  }
  if (pillar === 'software') {
    overrides.margin_pct = catalogItem.default_margin_pct ?? base.margin_pct;
    overrides.type = catalogItem.metadata?.license_type === 'subscription' ? 'subscription' : 'one_time';
  }
  if (pillar === 'installation') {
    overrides.margin_pct = catalogItem.default_margin_pct ?? base.margin_pct;
  }
  if (pillar === 'human_resources') {
    overrides.role = catalogItem.name;
    overrides.regulatory_source = catalogItem.source || 'Custom';
    overrides.reference_code = catalogItem.metadata?.inkindo_reference || '';
    overrides.rate_per_month = catalogItem.unit_cost || 0;
    overrides.region_coefficient = catalogItem.metadata?.province_index ?? null;
  }
  return addRow(state, pillar, overrides);
}

function updateRow(state, pillar, rowId, patch) {
  const items = state.pillars[pillar].items;
  const idx = items.findIndex((r) => r.id === rowId);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch };
  state.dirty = true;
  return items[idx];
}

function deleteRow(state, pillar, rowId) {
  const items = state.pillars[pillar].items;
  const idx = items.findIndex((r) => r.id === rowId);
  if (idx === -1) return false;
  items.splice(idx, 1);
  state.dirty = true;
  return true;
}

function duplicateRow(state, pillar, rowId) {
  const items = state.pillars[pillar].items;
  const idx = items.findIndex((r) => r.id === rowId);
  if (idx === -1) return null;
  const copy = { ...items[idx], id: newId(`row-${pillar.slice(0, 3)}`) };
  items.splice(idx + 1, 0, copy);
  state.dirty = true;
  return copy;
}

function updateConfig(state, path, value) {
  const segments = path.split('.');
  let obj = state.config;
  for (let i = 0; i < segments.length - 1; i++) {
    obj = obj[segments[i]];
  }
  obj[segments[segments.length - 1]] = value;
  state.dirty = true;
}

function recalculateTotals(state) {
  const totals = computeGrandTotals(state);
  state.cached_totals = {
    hardware: totals.pillar_totals.hardware,
    software: totals.pillar_totals.software,
    installation: totals.pillar_totals.installation,
    human_resources: totals.pillar_totals.human_resources,
    taxable_base: totals.taxable_base,
    ppn: totals.ppn_total,
    grand_total: totals.grand_total_after_tax,
  };
  return totals;
}
