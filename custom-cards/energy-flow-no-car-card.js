/**
 * energy-flow-no-car-card  v1.1
 *
 * Custom Lovelace card: Energy flow diagram where
 *   Home = grid_import + solar + bat_discharge − grid_export − bat_charge − car
 *
 * Responds to energy-date-selection by subscribing to the same energy collection
 * that HA's built-in energy cards use, obtained via the date-selection card element
 * in the DOM (no dynamic import of hashed HA bundle files needed).
 *
 * SETUP
 * 1. Copy to /config/www/energy-flow-no-car-card.js
 * 2. Add resource: Settings → Dashboards → Resources
 *      URL:  /local/energy-flow-no-car-card.js
 *      Type: JavaScript module
 * 3. Add card YAML (see below).
 *
 * YAML
 * ----
 * type: custom:energy-flow-no-car-card
 * title: Energiestroom (excl. auto)
 * battery_for_home: true   # optional — see below
 * entities:
 *   grid:
 *     entity:
 *       production: sensor.electricity_meter_energieproductie_sum
 *       consumption: sensor.electricity_meter_energieverbruik_sum
 *   solar:
 *     entity: sensor.envoy_122317102934_lifetime_energy_production
 *   battery:
 *     entity:
 *       production: sensor.batterij_laden_energy
 *       consumption: sensor.battery_ontladen_energy
 *   car:
 *     entity: sensor.wallbox_portal_added_energy
 *     name: Auto (Kona)
 *
 * battery_no_grid_return (default false)
 *   When true: hides the battery → grid line ("0 op de meter" setups where
 *   the battery never returns energy to the grid).
 *
 * battery_for_home (default false)
 *   When true: battery discharge is treated as going entirely to home.
 *   - The battery line is drawn directly to the home circle (not via the junction).
 *   - The home arc shows battery's fraction as batteryDischarge / home.
 *   When false (default): battery is routed through the junction and its arc
 *   fraction is batteryDischarge / total_junction_inflows.
 */

class EnergyFlowNoCarCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._data = null;
    this._unsubscribe = null;
    this._subscribed = false;
  }

  // ── HA card API ──────────────────────────────────────────────────────────

  setConfig(config) {
    if (!config.entities) throw new Error('energy-flow-no-car-card: entities required');
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._subscribed && this._config) this._subscribe();
  }

  getCardSize() { return 5; }

  // ── Energy collection ────────────────────────────────────────────────────
  //
  // energy-flow-card-plus stores the collection directly on hass.connection
  // using key "_energy_<panelUrl>" or falling back to "_energy".
  // Source: at=(e,t)=>{const i=e.connection,o=[it(e,t),"_energy"];...}
  //         it=(e,t)=>t?`_${t}`:e.panelUrl?`_energy_${e.panelUrl}`:"_energy"

  async _subscribe() {
    this._subscribed = true;
    for (let i = 0; i < 20; i++) {
      const col = this._findEnergyCollection();
      if (col) {
        console.log('[energy-flow-no-car-card] collection found, subscribing');
        this._unsubscribe = col.subscribe((data) => {
          if (!data) return;
          console.log('[energy-flow-no-car-card] period:', data.start, '–', data.end);
          this._fetchStatsForPeriod(data.start, data.end);
        });
        return;
      }
      if (i === 0) console.log('[energy-flow-no-car-card] waiting for energy collection…',
        'panelUrl:', this._hass?.panelUrl,
        'connection keys:', Object.keys(this._hass?.connection ?? {}).filter(k => k.startsWith('_energy')));
      await new Promise(r => setTimeout(r, 500));
    }
    console.warn('[energy-flow-no-car-card] energy collection not found on hass.connection');
  }

  _findEnergyCollection() {
    const conn = this._hass?.connection;
    if (!conn) return null;
    const panelUrl = this._hass.panelUrl;
    const keys = panelUrl ? [`_energy_${panelUrl}`, '_energy'] : ['_energy'];
    for (const key of keys) {
      const col = conn[key];
      if (col && typeof col.subscribe === 'function') {
        console.log('[energy-flow-no-car-card] found collection at connection.' + key);
        return col;
      }
    }
    return null;
  }

  disconnectedCallback() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
      this._subscribed = false;
    }
  }

  // ── Data fetching ────────────────────────────────────────────────────────
  //
  // We use the energy collection only for the selected date range.
  // Stats are fetched directly for the configured entity IDs, so the card
  // works with any entity — not just those registered in the energy config.

  async _fetchStatsForPeriod(start, end) {
    const ent = this._config.entities;
    const ids = [
      ent.grid.entity.consumption,
      ent.grid.entity.production,
      ent.solar.entity,
      ent.battery.entity.production,
      ent.battery.entity.consumption,
      ent.car.entity,
    ].filter(Boolean);

    const stats = await this._hass.callWS({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      end_time: (end ?? new Date()).toISOString(),
      period: 'day',
      statistic_ids: ids,
    });

    // Sum daily changes for the period. Use .change if present,
    // fall back to consecutive .sum diff.
    const kwh = (id) => {
      const s = stats[id];
      if (!s?.length) return 0;
      let total = 0;
      for (let i = 0; i < s.length; i++) {
        const change = s[i].change != null
          ? s[i].change
          : (i > 0 ? Math.max(0, (s[i].sum ?? 0) - (s[i - 1].sum ?? 0)) : 0);
        total += Math.max(0, change);
      }
      // Convert Wh → kWh when the sensor's native unit is Wh (e.g. Enphase)
      const unit = this._hass.states[id]?.attributes?.unit_of_measurement ?? 'kWh';
      return total * (unit === 'Wh' ? 0.001 : 1);
    };

    this._data = {
      gridImport:       kwh(ent.grid.entity.consumption),
      gridExport:       kwh(ent.grid.entity.production),
      solar:            kwh(ent.solar.entity),
      batteryCharge:    kwh(ent.battery.entity.production),
      batteryDischarge: kwh(ent.battery.entity.consumption),
      car:              kwh(ent.car.entity),
    };
    this._render();
  }

  // ── SVG rendering ────────────────────────────────────────────────────────

  _f(v) {
    if (v == null || isNaN(v)) return '—';
    if (v >= 1000) return `${(v / 1000).toFixed(2)} MWh`;
    return `${v.toFixed(1)} kWh`;
  }

  _render() {
    if (!this._config) return;

    const d = this._data;
    const ent = this._config.entities;
    const title = this._config.title ?? 'Energiestroom';
    const carName = ent.car?.name ?? 'Auto';
    const batteryForHome = !!this._config.battery_for_home;

    const home = d ? Math.max(0,
      (d.gridImport || 0) + (d.solar || 0) + (d.batteryDischarge || 0)
      - (d.gridExport || 0) - (d.batteryCharge || 0) - (d.car || 0)
    ) : null;

    // ── Node positions (SVG 480 × 410) ──────────────────────────────────────
    //
    //          Solar→Grid (left side, orange)
    //          Battery→Grid (left side, pink)
    //
    //  [Solar] ────────────────── [Car]
    //  [Grid]  ──×──────────────── [Home]   × = 1 accepted crossing
    //  [Battery]──────────────────[Home]  ← same y, horizontal
    //
    //  Left vertical: Solar→Battery (straight, when battery_no_grid_return)
    //  Left→Center diagonals: Solar→Grid, Battery→Grid
    //  Center→Right diagonals: Grid→Car, Grid→Home
    //  Horizontal: Solar→Car (top), Battery→Home (bottom)

    const S = { x: 80,  y: 78  };   // Solar   (top-left)
    const G = { x: 240, y: 204 };   // Grid    (center)       — midpoint of Solar/Battery y
    const B = { x: 80,  y: 330 };   // Battery (bottom-left)  — same y as Home
    const H = { x: 398, y: 330 };   // Home    (bottom-right) — same y as Battery
    const C = { x: 398, y: 78  };   // Car     (top-right)    — same y as Solar

    const R = { S: 38, G: 50, B: 42, H: 52, C: 52 };

    // Colors matching energy-flow-card-plus / HA energy CSS variables
    const COL = {
      grid:       'var(--energy-grid-consumption-color, #488fc2)',
      gridReturn: 'var(--energy-grid-return-color, #8353d1)',
      solar:      'var(--energy-solar-color, #ff9800)',
      batteryIn:  'var(--energy-battery-in-color, #f06292)',
      batteryOut: 'var(--energy-battery-out-color, #4db6ac)',
      car:        '#488fc2',
    };

    // Helper: SVG straight line
    const L = (x1, y1, x2, y2, color) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
             stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;

    // Helper: SVG cubic bezier curve (two control points)
    const CURVE = (x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2, color) =>
      `<path d="M ${x1} ${y1} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x2} ${y2}"
              fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;

    // Helper: circle (transparent fill = card background visible through)
    const CIR = (x, y, r, col) =>
      `<circle cx="${x}" cy="${y}" r="${r}"
               fill="var(--ha-card-background,#1c1c1e)"
               stroke="${col}" stroke-width="3"/>`;

    // Helper: ha-icon via foreignObject
    const ICO = (cx, cy, icon, col, size = 26) => {
      const h = size / 2;
      return `<foreignObject x="${cx-h}" y="${cy-h}" width="${size}" height="${size}">
        <body xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;overflow:hidden">
          <ha-icon icon="${icon}"
            style="--mdc-icon-size:${size}px;color:${col};display:block"></ha-icon>
        </body>
      </foreignObject>`;
    };

    // Helper: SVG text — use style attribute so CSS variables resolve correctly
    const T = (x, y, text, fill = '#ccc', size = 12, bold = false) =>
      `<text x="${x}" y="${y}" text-anchor="middle"
             style="fill:${fill};font-size:${size}px;font-weight:${bold ? '600' : 'normal'}">${text}</text>`;

    // ── Home circle: proportional arc per source (solar / grid / battery) ───
    const arc = (frac, offset, color) => frac < 0.005 ? '' : (() => {
      const circ = 2 * Math.PI * (R.H - 1.5);
      // dasharray = "arc_len gap_len" where arc_len + gap_len = circumference
      // dashoffset = circumference * (1 - start_fraction) positions the start correctly
      return `<circle cx="${H.x}" cy="${H.y}" r="${R.H - 1.5}" fill="none"
           stroke="${color}" stroke-width="4"
           stroke-dasharray="${frac * circ} ${circ * (1 - frac)}"
           stroke-dashoffset="${2 * Math.PI * (R.H - 1.5) * (1 - offset)}"
           transform="rotate(-90, ${H.x}, ${H.y})"/>`;
    })();

    let homeArcs = '';
    if (d && home > 0) {
      if (batteryForHome) {
        // Battery covers its fraction of home directly; remainder split solar/grid
        const bf = Math.min(1, (d.batteryDischarge || 0) / home);
        const remaining = 1 - bf;
        const otherIn = (d.solar || 0) + Math.max(0, d.gridImport || 0);
        const sf = otherIn > 0 ? remaining * (d.solar || 0) / otherIn : 0;
        const gf = otherIn > 0 ? remaining * Math.max(0, d.gridImport || 0) / otherIn : 0;
        homeArcs = arc(sf, 0, COL.solar) + arc(gf, sf, COL.grid) + arc(bf, sf + gf, COL.batteryOut);
      } else {
        // Fractions of total junction inflows
        const inflows = (d.solar || 0) + Math.max(0, d.gridImport || 0) + (d.batteryDischarge || 0);
        if (inflows > 0) {
          const sf = (d.solar || 0) / inflows;
          const gf = Math.max(0, d.gridImport || 0) / inflows;
          const bf = (d.batteryDischarge || 0) / inflows;
          homeArcs = arc(sf, 0, COL.solar) + arc(gf, sf, COL.grid) + arc(bf, sf + gf, COL.batteryOut);
        }
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px 12px 24px; }
        .title {
          font-size: 1.3em;
          font-weight: 500;
          color: var(--primary-text-color, #e0e0e0);
          margin-bottom: 4px;
          padding: 0 4px;
        }
        svg { width: 100%; height: auto; display: block; overflow: visible; }
      </style>
      <ha-card>
        <div class="title">${title}</div>
        <svg viewBox="0 0 480 410"
             xmlns="http://www.w3.org/2000/svg"
             font-family="var(--primary-font-family, Roboto, sans-serif)">

          ${!d ? T(240, 205, 'Wacht op energiedata…', '#888', 13) : ''}

          <!-- Solar → Battery: straight vertical on left (solar charges battery) -->
          ${this._config.battery_no_grid_return ? L(S.x, S.y + R.S, B.x, B.y - R.B, COL.solar) : ''}

          <!-- Solar → Grid: to top-left of Grid (45°) -->
          ${L(S.x + R.S * 0.924, S.y + R.S * 0.383, G.x - R.G * 0.707, G.y - R.G * 0.707, COL.solar)}
          <!-- Battery → Grid (when applicable) -->
          ${this._config.battery_no_grid_return ? '' : L(B.x + R.B, B.y, G.x - R.G, G.y, COL.batteryIn)}

          <!-- Grid → Car / Grid → Home (diagonals from center to right) -->
          ${L(G.x + R.G * 0.707, G.y - R.G * 0.707, C.x - R.C * 0.707, C.y + R.C * 0.707, COL.grid)}
          ${L(G.x + R.G * 0.707, G.y + R.G * 0.707, H.x - R.H * 0.707, H.y - R.H * 0.707, COL.grid)}

          <!-- Solar → Car (horizontal) -->
          ${L(S.x + R.S, S.y, C.x - R.C, C.y, COL.solar)}
          <!-- Solar → Home: curve below Grid circle -->
          ${CURVE(S.x + R.S * 0.707, S.y + R.S * 0.707, G.x - 40, G.y + R.G + 46, G.x + 40, G.y + R.G + 46, H.x - R.H * 0.924, H.y - R.H * 0.383, COL.solar)}

          <!-- Battery → Home: straight horizontal (same y) -->
          ${L(B.x + R.B, B.y, H.x - R.H, H.y, COL.batteryOut)}

          <!-- ── Grid ── -->
          ${CIR(G.x, G.y, R.G, COL.grid)}
          ${T(G.x, G.y - R.G - 8, 'Grid', '#888')}
          ${ICO(G.x, G.y - 14, 'mdi:transmission-tower', COL.grid)}
          ${T(G.x, G.y + 8,  d ? `← ${this._f(d.gridExport)}`  : '—', COL.gridReturn, 11)}
          ${T(G.x, G.y + 22, d ? `→ ${this._f(d.gridImport)}`  : '',  COL.grid,       11)}

          <!-- ── Solar ── -->
          ${CIR(S.x, S.y, R.S, COL.solar)}
          ${T(S.x, S.y - R.S - 8, 'Solar', '#888')}
          ${ICO(S.x, S.y - 10, 'mdi:solar-power', COL.solar)}
          ${T(S.x, S.y + 20, d ? this._f(d.solar) : '—', 'rgb(225,225,225)', 13, true)}

          <!-- ── Car ── -->
          ${CIR(C.x, C.y, R.C, COL.car)}
          ${ICO(C.x, C.y - 10, 'mdi:car-electric', COL.car)}
          ${T(C.x, C.y + 20, d ? this._f(d.car) : '—', 'rgb(225,225,225)', 13, true)}
          ${T(C.x, C.y - R.C - 8, carName, '#888')}

          <!-- ── Battery ── -->
          ${CIR(B.x, B.y, R.B, COL.batteryIn)}
          ${ICO(B.x, B.y - 10, 'mdi:battery-medium', COL.batteryIn, 24)}
          ${T(B.x, B.y + 10, d ? `↓ ${this._f(d.batteryCharge)}`    : '—', COL.batteryIn,  11)}
          ${T(B.x, B.y + 24, d ? `↑ ${this._f(d.batteryDischarge)}` : '',  COL.batteryOut, 11)}
          ${T(B.x, B.y + R.B + 16, 'Batterij', '#888')}

          <!-- ── Home (larger, with proportional source arcs) ── -->
          ${CIR(H.x, H.y, R.H, '#444')}
          ${homeArcs}
          ${ICO(H.x, H.y - 16, 'mdi:home', 'white', 28)}
          ${T(H.x, H.y + 16, home != null ? this._f(home) : '—', 'rgb(225,225,225)', 14, true)}
          ${T(H.x, H.y + R.H + 16, 'Thuis', '#888')}

        </svg>
      </ha-card>
    `;
  }
}

customElements.define('energy-flow-no-car-card', EnergyFlowNoCarCard);
window.customCards ??= [];
window.customCards.push({
  type: 'energy-flow-no-car-card',
  name: 'Energy Flow (excl. auto)',
  description: 'Energy flow with Home = total − car. Syncs with energy-date-selection.',
  preview: false,
});
