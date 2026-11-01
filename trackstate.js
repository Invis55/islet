'use strict';
// Turns OpenF1 race_control messages into one "track status" the UI and ambient light can show.
//   green | yellow | double | sc | sc-end | vsc | vsc-end | red | chequered
// Priority (highest first): red, safety car, virtual safety car, double yellow, yellow, chequered, green.

const HAZARDS = new Set(['yellow', 'double', 'sc', 'sc-end', 'vsc', 'vsc-end', 'red']);

class TrackState {
  constructor() { this.reset(); }

  reset() {
    this.sectors = new Map();   // marshal sector -> 'yellow' | 'double'
    this.trackYellow = false;
    this.sc = null;             // null | 'sc' | 'sc-end'
    this.vsc = null;            // null | 'vsc' | 'vsc-end'
    this.red = false;
    this.chequered = false;
    this.mode = 'green';
  }

  _mode() {
    if (this.red) return 'red';
    if (this.sc) return this.sc;
    if (this.vsc) return this.vsc;
    if ([...this.sectors.values()].includes('double')) return 'double';
    if (this.sectors.size || this.trackYellow) return 'yellow';
    if (this.chequered) return 'chequered';
    return 'green';
  }

  _clearAll() { this.sectors.clear(); this.trackYellow = false; this.sc = null; this.vsc = null; this.red = false; }

  // Feed one race_control event: { category, flag, scope, sector, message }.
  // Returns { changed, mode, label, sign, sectors, pulseGreen } where pulseGreen means "a hazard just ended: flash green".
  apply(ev) {
    const prev = this.mode;
    const cat = String(ev.category || '').toLowerCase();
    const flag = String(ev.flag || '').toUpperCase();
    const scope = String(ev.scope || '').toLowerCase();
    const msg = String(ev.message || '').toUpperCase();
    const sector = ev.sector != null && ev.sector !== '' ? Number(ev.sector) : null;

    if (cat === 'safetycar') {
      if (/VIRTUAL SAFETY CAR DEPLOYED/.test(msg)) this.vsc = 'vsc';
      else if (/VIRTUAL SAFETY CAR ENDING/.test(msg)) this.vsc = 'vsc-end';
      else if (/SAFETY CAR IN THIS LAP/.test(msg)) this.sc = 'sc-end';
      else if (/SAFETY CAR DEPLOYED/.test(msg)) { this.sc = 'sc'; this.chequered = false; }
    } else if (cat === 'flag') {
      if (flag === 'RED') this.red = true;
      else if (flag === 'GREEN') { if (scope !== 'sector' && scope !== 'driver') this._clearAll(); else if (sector != null) this.sectors.delete(sector); }
      else if (flag === 'CLEAR') {
        if (scope === 'sector' && sector != null) this.sectors.delete(sector);
        else if (scope === 'track' || !scope) { this.sectors.clear(); this.trackYellow = false; }
      } else if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW') {
        if (scope === 'sector' && sector != null) this.sectors.set(sector, flag === 'DOUBLE YELLOW' ? 'double' : (this.sectors.get(sector) === 'double' ? 'double' : 'yellow'));
        else if (scope === 'track') this.trackYellow = true;
        // driver-specific yellows (a single car) don't change the track status
      } else if (flag === 'CHEQUERED') this.chequered = true;
    } else if (cat === 'sessionstatus') {
      if (/STARTED/.test(msg)) { this._clearAll(); this.chequered = false; }
      else if (/FINISHED|ENDED|ABORTED/.test(msg)) { this.sectors.clear(); this.trackYellow = false; this.sc = null; this.vsc = null; this.red = false; }
    }

    this.mode = this._mode();
    return { ...this.view(), changed: this.mode !== prev || cat === 'flag' || cat === 'safetycar', pulseGreen: HAZARDS.has(prev) && this.mode === 'green' };
  }

  view() {
    const sectors = [...this.sectors.keys()].sort((a, b) => a - b);
    const sec = sectors.length ? ` · S${sectors.slice(0, 3).join(', S')}${sectors.length > 3 ? '…' : ''}` : '';
    const labels = {
      green: ['TRACK CLEAR', ''], yellow: [`YELLOW${sec}`, 'Y'], double: [`DOUBLE YELLOW${sec}`, 'YY'], sc: ['SAFETY CAR', 'SC'], 'sc-end': ['SAFETY CAR IN THIS LAP', 'SC'],
      vsc: ['VIRTUAL SAFETY CAR', 'VSC'], 'vsc-end': ['VSC ENDING', 'VSC'], red: ['RED FLAG', 'RED'], chequered: ['CHEQUERED FLAG', ''],
    };
    const [label, sign] = labels[this.mode];
    return { mode: this.mode, label, sign, sectors };
  }
}

module.exports = { TrackState, HAZARDS };
