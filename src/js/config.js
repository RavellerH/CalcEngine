/* Default configuration, constants, and enums for Deviota CalcEngine. */

const APP_NAME = 'Deviota CalcEngine';
const APP_VERSION = '1.0.0';

const PILLARS = ['hardware', 'software', 'installation', 'human_resources'];

const PILLAR_LABELS = {
  hardware: 'Hardware',
  software: 'Software',
  installation: 'Installation',
  human_resources: 'Human Resources',
};

const CURRENCIES = ['IDR', 'USD'];

const SOFTWARE_TYPES = ['one_time', 'subscription', 'maintenance'];

const HR_RATE_BASIS = ['person_month', 'person_day', 'lump_sum'];

const HR_REGULATORY_SOURCES = ['INKINDO', 'SBM', 'Custom'];

function defaultConfig() {
  return {
    display_currency: 'IDR',
    fx: {
      mode: 'manual',
      usd_to_idr: 16500.0,
      last_update: null,
      api_used: false,
      api_url: '',
    },
    tax: {
      ppn_enabled: true,
      ppn_rate: 0.11,
      use_advanced_dpp: false,
      dpp_factor: 11 / 12,
    },
    hr: {
      inkindo_preset_id: 'INK-2024-JAKARTA',
      region_coefficient: 1.0,
      sbm_preset_id: 'SBM-2026',
      enforce_sbm_caps: true,
      allow_manual_override: true,
      working_days_per_month: 22,
    },
  };
}

function defaultProject() {
  return {
    name: 'New Simulation',
    client: '',
    contact_person: '',
    notes: '',
  };
}

function emptyPillars() {
  return {
    hardware: { items: [] },
    software: { items: [] },
    installation: { items: [] },
    human_resources: { items: [] },
  };
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
