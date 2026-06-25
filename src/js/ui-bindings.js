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

    // --- PCB Quotation (Google Sheets pricing DB) ------------------------
    pcbModalOpen: false,
    pcbSheetUrl: '',
    pcbCatalog: [],
    pcbCatalogStatus: '',
    pcbRows: [],
    pcbUploadStatus: '',
    pcbTransportTotal: 0,
    pcbMultiplier: 2,
    pcbExportStatus: '',
    pcbAppsScriptUrl: '',
    pcbSharedSecret: '',
    pcbAppsScriptStatus: '',

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

    // --- PCB Quotation (Google Sheets pricing DB) ------------------------

    openPcbModal() {
      this.pcbModalOpen = true;
    },

    async fetchPcbCatalog() {
      this.pcbCatalogStatus = 'Fetching...';
      try {
        this.pcbCatalog = await fetchPcbPricingSheet(this.pcbSheetUrl);
        this.pcbCatalogStatus = `Loaded ${this.pcbCatalog.length} pricing rows from the Sheet.`;
      } catch (err) {
        this.pcbCatalogStatus = `Error: ${err.message}`;
      }
    },

    async fetchPcbCatalogViaAppsScript() {
      this.pcbAppsScriptStatus = 'Fetching...';
      try {
        this.pcbCatalog = await fetchPcbPricingViaAppsScript(this.pcbAppsScriptUrl);
        this.pcbAppsScriptStatus = `Loaded ${this.pcbCatalog.length} pricing rows via Apps Script.`;
      } catch (err) {
        this.pcbAppsScriptStatus = `Error: ${err.message}`;
      }
    },

    async pushPcbQuotationToSheet() {
      this.pcbAppsScriptStatus = 'Pushing to Sheet...';
      try {
        const appended = await pushQuotationToAppsScript(this.pcbAppsScriptUrl, this.pcbSharedSecret, this.pcbQuotationRows());
        this.pcbAppsScriptStatus = `Pushed ${appended} rows to the Sheet — sell price is a live formula.`;
      } catch (err) {
        this.pcbAppsScriptStatus = `Error: ${err.message}`;
      }
    },

    async onPcbFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      this.pcbUploadStatus = 'Parsing...';
      try {
        const rows = /\.pdf$/i.test(file.name) ? await parsePdfBom(file) : await parseBomFile(file);
        this.pcbRows = matchBomToCatalog(rows, this.pcbCatalog);
        this.pcbUploadStatus = `Parsed ${this.pcbRows.length} line items. Review and correct below before exporting.`;
      } catch (err) {
        this.pcbUploadStatus = `Error: ${err.message}`;
      } finally {
        event.target.value = '';
      }
    },

    pcbQuotationRows() {
      return computeQuotationRows(this.pcbRows, {
        transportTotal: this.pcbTransportTotal,
        multiplier: this.pcbMultiplier,
      });
    },

    pcbBatchTotal() {
      const rows = this.pcbQuotationRows();
      const total = rows.reduce((acc, r) => acc + (r.row_total || 0), 0);
      return this.formatMoney(total);
    },

    addPcbRowsToHardware() {
      const rows = this.pcbQuotationRows();
      rows.forEach((r) => {
        addRow(this.state, 'hardware', {
          name: r.name,
          source: r.source || '',
          quantity: r.quantity,
          currency: r.currency || 'USD',
          unit_cost: r.capital_cost,
          margin_pct: (Number(r.min_multiplier) || 2) - 1,
          transport_cost: r.transport_cost,
        });
      });
      this.activePillar = 'hardware';
      this.pcbModalOpen = false;
      this.recalc();
    },

    downloadPcbQuotationWorkbook() {
      try {
        downloadQuotationWorkbook(this.pcbQuotationRows());
        this.pcbExportStatus = 'Workbook downloaded.';
      } catch (err) {
        this.pcbExportStatus = `Error: ${err.message}`;
      }
    },

    async copyPcbQuotationForSheets() {
      try {
        const count = await copyQuotationForSheets(this.pcbQuotationRows());
        this.pcbExportStatus = `Copied ${count} rows — paste into your pricing Sheet (formulas stay live).`;
      } catch (err) {
        this.pcbExportStatus = `Error: ${err.message}`;
      }
    },
  };
}
