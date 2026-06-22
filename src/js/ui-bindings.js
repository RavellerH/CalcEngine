/* Alpine.js root component. Binds DOM to state.js mutations and calculations.js. */

function calcEngine() {
  return {
    state: createAppState(),
    totals: null,
    activePillar: 'hardware',
    pillars: PILLARS,
    pillarLabels: PILLAR_LABELS,
    catalog: [],
    catalogModalOpen: false,
    sidebarOpen: false,
    fxStatus: '',
    saveStatus: '',

    async init() {
      try {
        const res = await fetch('data/prices.json');
        this.catalog = res.ok ? await res.json() : [];
      } catch (err) {
        console.warn('Could not load price catalog:', err);
        this.catalog = [];
      }

      const lastSession = loadStateFromLocalStorage();
      if (lastSession) {
        hydrateStateFromImport(this.state, lastSession);
      }

      this.recalc();

      // Totals recalculate immediately; only the localStorage write is debounced.
      let saveTimer = null;
      this.$watch('state', () => {
        this.recalc();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveStateToLocalStorage(this.state);
          this.saveStatus = 'Saved locally';
          setTimeout(() => (this.saveStatus = ''), 1500);
        }, 400);
      }, { deep: true });
    },

    recalc() {
      // Pure computation only — must not mutate this.state, which is deep-watched
      // above; writing back into it (e.g. state.cached_totals) would re-trigger
      // the watcher on every recalculation and loop forever.
      this.totals = computeGrandTotals(this.state);
    },

    formatMoney(value) {
      const currency = this.state.config.display_currency;
      const num = Number(value) || 0;
      return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },

    rowSubtotal(rowId) {
      return this.totals?.pillar_totals?._subtotals?.[rowId] ?? 0;
    },

    // --- Row CRUD -----------------------------------------------------

    addRow(pillar) {
      addRow(this.state, pillar);
      this.recalc();
    },

    deleteRow(pillar, rowId) {
      if (!confirm('Delete this row?')) return;
      deleteRow(this.state, pillar, rowId);
      this.recalc();
    },

    duplicateRow(pillar, rowId) {
      duplicateRow(this.state, pillar, rowId);
      this.recalc();
    },

    openCatalog(pillar) {
      this.activePillar = pillar;
      this.catalogModalOpen = true;
    },

    catalogItemsForActivePillar() {
      return this.catalog.filter((item) => item.pillar === this.activePillar);
    },

    addFromCatalog(catalogItem) {
      addRowFromCatalogItem(this.state, this.activePillar, catalogItem);
      this.catalogModalOpen = false;
      this.recalc();
    },

    // --- SBM cap warning ------------------------------------------------

    sbmWarning(row) {
      if (row.regulatory_source !== 'SBM') return null;
      // Cap values are organization-maintained in data/sbm-presets.json and are
      // null by default (see docs/design.md 4.6); only warn once a cap is set.
      return null;
    },

    // --- Header actions -------------------------------------------------

    newSimulation() {
      if (this.state.dirty && !confirm('Start a new simulation? Unsaved changes will be lost.')) return;
      this.state = createAppState();
      clearLocalStorageSession();
      this.recalc();
    },

    triggerLoadJson() {
      this.$refs.loadJsonInput.click();
    },

    async onLoadJsonFile(event) {
      const file = event.target.files[0];
      if (!file) return;
      try {
        await importStateFromJsonFile(this.state, file);
        this.recalc();
      } catch (err) {
        alert(`Failed to load simulation: ${err.message}`);
      } finally {
        event.target.value = '';
      }
    },

    saveJson() {
      this.recalc();
      recalculateTotals(this.state); // populate cached_totals on the exported snapshot
      exportStateToJson(this.state);
      this.state.dirty = false;
    },

    exportPdf() {
      this.recalc();
      try {
        exportStateToPdf(this.state, this.totals);
      } catch (err) {
        alert(`PDF export failed: ${err.message}`);
      }
    },

    exportExcel() {
      this.recalc();
      try {
        exportStateToExcel(this.state, this.totals);
      } catch (err) {
        alert(`Excel export failed: ${err.message}`);
      }
    },

    async fetchFx() {
      this.fxStatus = 'Fetching...';
      try {
        const rate = await fetchFxRate(this.state.config.fx.api_url);
        this.state.config.fx.usd_to_idr = rate;
        this.state.config.fx.last_update = new Date().toISOString();
        this.state.config.fx.api_used = true;
        this.fxStatus = `Updated: 1 USD = ${rate.toLocaleString()} IDR`;
        this.recalc();
      } catch (err) {
        this.fxStatus = `Error: ${err.message}`;
      }
    },
  };
}
