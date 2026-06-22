/* JSON save/load logic, localStorage auto-save, and FX rate fetching. */

const LOCAL_STORAGE_KEY = 'deviota-calcengine-last-session';

function serializeState(state) {
  const snapshot = JSON.parse(JSON.stringify(state));
  delete snapshot.catalog;
  delete snapshot.dirty;
  snapshot.meta = {
    ...snapshot.meta,
    app: APP_NAME,
    exported_at: new Date().toISOString(),
  };
  return snapshot;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportStateToJson(state) {
  const snapshot = serializeState(state);
  const safeName = (state.project.name || 'simulation').replace(/[^a-z0-9-_]+/gi, '_');
  downloadJson(`${safeName}-calcengine.json`, snapshot);
}

function hydrateStateFromImport(state, imported) {
  if (!imported || typeof imported !== 'object') {
    throw new Error('Invalid simulation file.');
  }
  state.version = imported.version || state.version;
  state.meta = { ...state.meta, ...imported.meta };
  state.project = { ...defaultProject(), ...imported.project };
  state.config = {
    ...defaultConfig(),
    ...imported.config,
    fx: { ...defaultConfig().fx, ...imported.config?.fx },
    tax: { ...defaultConfig().tax, ...imported.config?.tax },
    hr: { ...defaultConfig().hr, ...imported.config?.hr },
  };
  state.pillars = { ...emptyPillars(), ...imported.pillars };
  PILLARS.forEach((p) => {
    if (!state.pillars[p]) state.pillars[p] = { items: [] };
    if (!Array.isArray(state.pillars[p].items)) state.pillars[p].items = [];
  });
  state.cached_totals = imported.cached_totals || state.cached_totals;
  state.dirty = false;
}

function importStateFromJsonFile(state, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        hydrateStateFromImport(state, parsed);
        resolve(state);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function saveStateToLocalStorage(state) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializeState(state)));
  } catch (err) {
    console.warn('Failed to auto-save session to localStorage:', err);
  }
}

function loadStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('Failed to read last session from localStorage:', err);
    return null;
  }
}

function clearLocalStorageSession() {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}

/** Fetches USD->IDR rate from a configurable API URL. Falls back gracefully on failure. */
async function fetchFxRate(apiUrl) {
  if (!apiUrl) {
    throw new Error('No FX API URL configured.');
  }
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`FX API request failed with status ${response.status}`);
  }
  const data = await response.json();
  // Supports the common { rates: { IDR: number } } shape (e.g. exchangerate.host / open.er-api.com).
  const rate = data?.rates?.IDR ?? data?.usd_to_idr ?? null;
  if (!rate || Number.isNaN(Number(rate))) {
    throw new Error('Could not find a usable USD->IDR rate in the API response.');
  }
  return Number(rate);
}
