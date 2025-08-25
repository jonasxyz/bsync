// adBlockLists.js (CommonJS, Node >=14)
// Lädt EasyList (Ads) + EasyPrivacy (Tracking) mit @ghostery/adblocker,
// cached die kompilierten Engines als .bin und stellt einfache Match-APIs bereit.
// using:   https://www.npmjs.com/package/@ghostery/adblocker

const fs = require('fs');
const path = require('path');

class AdBlockLists {
  /**
   * @param {Object} opts
   * @param {boolean} [opts.verbose=false]
   * @param {string}  [opts.cacheDir]        Pfad für Engine-Cache
   * @param {number}  [opts.refreshDays=7]   Max. Alter des Caches
   * @param {string[]} [opts.extraListsAds]      zusätzliche Ads-Listen
   * @param {string[]} [opts.extraListsTracking] zusätzliche Tracking-Listen
   */
  constructor(opts = {}) {
    this.verbose = !!opts.verbose;
    this.cacheDir = opts.cacheDir || path.join(__dirname, '.adblock-cache');
    this.maxAgeMs = (opts.refreshDays ?? 7) * 24 * 60 * 60 * 1000;

    this.urls = {
      easylist: [
        'https://easylist.to/easylist/easylist.txt', // Ads
        ...(opts.extraListsAds || []),
      ],
      easyprivacy: [
        'https://easylist.to/easylist/easyprivacy.txt', // Tracking
        ...(opts.extraListsTracking || []),
      ],
    };

    this.initialized = this._init(); // Promise, wird im Analyzer awaitet
  }

  async _init() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    // ESM-Import dynamisch, damit dein CJS-Projekt unverändert bleibt
    const { FiltersEngine, Request } = await import('@ghostery/adblocker');
    this.FiltersEngine = FiltersEngine;
    this.Request = Request;

    // fetch für Node (Node 18+ hat global fetch, sonst cross-fetch)
    let fetchFn = globalThis.fetch;
    if (!fetchFn) {
      fetchFn = (await import('cross-fetch')).default;
    }
    this.fetch = fetchFn;

    // Engines laden/erstellen (eine für Tracking, eine für Ads)
    this.trackingEngine = await this._loadOrBuildEngine({
      cacheFile: path.join(this.cacheDir, 'engine_easyprivacy.bin'),
      lists: this.urls.easyprivacy,
      label: 'EasyPrivacy',
    });

    this.adsEngine = await this._loadOrBuildEngine({
      cacheFile: path.join(this.cacheDir, 'engine_easylist.bin'),
      lists: this.urls.easylist,
      label: 'EasyList',
    });

    if (this.verbose) {
      console.log('[AdBlockLists] Engines bereit:', {
        tracking: !!this.trackingEngine,
        ads: !!this.adsEngine,
        cacheDir: this.cacheDir,
      });
    }
  }

  async _loadOrBuildEngine({ cacheFile, lists, label }) {
    try {
      if (fs.existsSync(cacheFile)) {
        const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
        if (age < this.maxAgeMs) {
          const bytes = fs.readFileSync(cacheFile);
          const engine = this.FiltersEngine.deserialize(new Uint8Array(bytes));
          if (this.verbose) console.log(`[AdBlockLists] ${label} aus Cache geladen (${path.basename(cacheFile)})`);
          return engine;
        }
      }
    } catch (e) {
      if (this.verbose) console.warn(`[AdBlockLists] Cache-Read ${label} fehlgeschlagen:`, e);
    }

    if (this.verbose) console.log(`[AdBlockLists] Baue ${label} Engine aus Listen:`, lists.join(', '));
    const engine = await this.FiltersEngine.fromLists(this.fetch, lists); // :contentReference[oaicite:2]{index=2}

    try {
      const serialized = engine.serialize();
      fs.writeFileSync(cacheFile, Buffer.from(serialized));
      if (this.verbose) console.log(`[AdBlockLists] ${label} Engine gecached: ${path.basename(cacheFile)}`);
    } catch (e) {
      if (this.verbose) console.warn(`[AdBlockLists] Cache-Write ${label} fehlgeschlagen:`, e);
    }

    return engine;
  }

  /**
   * Für HAR-Einträge: MIME -> request type raten (script, image, stylesheet, media, font, xhr, other)
   */
  _inferTypeFromHarEntry(entry) {
    const mime = entry?.response?.content?.mimeType?.toLowerCase?.() || '';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'text/css' || mime.includes('stylesheet')) return 'stylesheet';
    if (mime.includes('javascript')) return 'script';
    if (mime.startsWith('font/')) return 'font';
    if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
    if (mime.includes('json') || mime.includes('xml')) return 'xmlhttprequest';
    return 'other';
  }

  /**
   * Niedrig-Level-Match für eine URL
   * @returns { matched:boolean, category:'tracking'|'ads'|null, filterText?:string, exception?:boolean, redirect?:string }
   */
  match(url, { type = 'other', sourceUrl } = {}) {
    if (!this.trackingEngine || !this.adsEngine) return { matched: false, category: null };

    const raw = { type, url };
    if (sourceUrl) raw.sourceUrl = sourceUrl; // hilft bei 1st/3rd-party-Regeln
    const req = this.Request.fromRawDetails(raw); // :contentReference[oaicite:3]{index=3}

    // Hilfsfunktion für eine Engine
    const check = (engine) => {
      const res = engine.match(req); // { match, exception, redirect, filter } :contentReference[oaicite:4]{index=4}
      if (res && res.match) {
        if (res.exception) return { matched: false, exception: true };
        const filterText =
          (res.filter && (res.filter.raw || (typeof res.filter.toString === 'function' ? res.filter.toString() : res.filter.getFilter?.()))) || '';
        return { matched: true, filterText, redirect: res.redirect || null };
      }
      return { matched: false };
    };

    // Erst Tracking (EasyPrivacy), dann Ads (EasyList)
    let r = check(this.trackingEngine);
    if (r.matched) return { ...r, category: 'tracking' };

    r = check(this.adsEngine);
    if (r.matched) return { ...r, category: 'ads' };

    return { matched: false, category: null };
  }

  /**
   * Komfort-API: HAR-Entry klassifizieren
   */
  classifyHarEntry(entry, pageUrl) {
    const type = this._inferTypeFromHarEntry(entry);
    const url = entry?.request?.url;
    const res = this.match(url, { type, sourceUrl: pageUrl });
    return { url, type, sourceUrl: pageUrl, ...res };
  }

  /**
   * Backwards-Compat: true, wenn *irgendeine* Liste matcht (Ads ODER Tracking)
   */
  shouldBlock(url, type = 'other', sourceUrl) {
    return this.match(url, { type, sourceUrl }).matched;
  }
}

module.exports = AdBlockLists;
