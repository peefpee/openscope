function expiredTerrain(records) {
    return [...records].filter((record) => record.key.startsWith('terrain/'))
        .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)) || b.key.localeCompare(a.key))
        .slice(10);
}

// Store local imports separately so a worldwide fix or MSA file is shared across airports.
export class NavDataCache {
    constructor() {
        this.records = new Map();
        this.memoryOnly = new Set();
    }

    load() {
        if (!this.ready) {
            this.ready = new Promise((resolve, reject) => {
                const request = window.indexedDB.open('openscope-navdata', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'key' });
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const tx = db.transaction('files', 'readwrite');
                    const all = tx.objectStore('files').getAll();
                    all.onsuccess = () => {
                        expiredTerrain(all.result).forEach(({ key }) => tx.objectStore('files').delete(key));
                    };
                    tx.onabort = () => { db.close(); reject(tx.error); };
                    tx.oncomplete = () => {
                        all.result.forEach((record) => this.records.set(record.key, record));
                        expiredTerrain(this.records.values()).forEach(({ key }) => this.records.delete(key));
                        this.db = db;
                        db.onversionchange = () => { db.close(); this.db = null; };
                        resolve();
                    };
                };
            }).catch(() => { this.db = null; });
        }
        return this.ready;
    }

    getCompatibleRecord(key, { icao, airac } = {}) {
        const record = this.records.get(key);
        if (!record) return null;
        if (icao && record.icao && String(record.icao).toUpperCase() !== String(icao).toUpperCase()) {
            return null;
        }
        if (airac && record.airac && String(record.airac) !== String(airac)) {
            return null;
        }
        return record;
    }

    save(record) {
        return this.load().then(() => {
            this.records.set(record.key, record);
            this.memoryOnly.add(record.key);
            const terrain = record.key.startsWith('terrain/');
            if (terrain) {
                expiredTerrain(this.records.values()).forEach(({ key }) => {
                    this.records.delete(key);
                    this.memoryOnly.delete(key);
                });
            }
            if (!this.db) return;
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('files', 'readwrite');
                tx.oncomplete = resolve;
                tx.onabort = () => reject(tx.error);
                const store = tx.objectStore('files');
                store.put(record);
                if (terrain) {
                    const keys = store.getAll();
                    keys.onsuccess = () => expiredTerrain(keys.result).forEach(({ key }) => store.delete(key));
                }
            }).then(() => {
                if (this.records.get(record.key) === record) this.memoryOnly.delete(record.key);
            }).catch(() => {
                // The importer reports this record as session-only on quota or storage failure.
            });
        });
    }

    getTerrain(icao, options = {}) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code) return null;
        const record = this.records.get(`terrain/${code}`);
        if (!record || record.formatVersion !== 1 || !record.geojson) return null;
        if (options.coverageNm != null && record.coverageNm !== options.coverageNm) return null;
        if (options.coordinates && JSON.stringify(options.coordinates) !== JSON.stringify(record.coordinates)) return null;
        if (record.provider !== 'manual') {
            if (options.provider && options.provider !== 'auto' && options.provider !== record.provider) return null;
            for (const field of ['resolution', 'datasetVersion', 'contourIntervalFt']) {
                if (options[field] != null && options[field] !== record[field]) return null;
            }
        }
        return record;
    }

    saveTerrain(entry) {
        const code = String((entry && entry.icao) || '').trim().toUpperCase();
        if (!code || !entry.geojson) return Promise.resolve();
        const record = {
            key: `terrain/${code}`,
            icao: code,
            coordinates: entry.coordinates || null,
            coverageNm: entry.coverageNm || 60,
            provider: entry.provider || 'open-meteo',
            datasetVersion: entry.datasetVersion || '1',
            resolution: entry.resolution || '21x21',
            contourIntervalFt: entry.contourIntervalFt || 1000,
            generatedAt: entry.generatedAt || new Date().toISOString(),
            geojson: entry.geojson,
            attribution: entry.attribution || '',
            formatVersion: 1
        };
        return this.save(record);
    }

    clearTerrain(icao) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code) return Promise.resolve();
        const key = `terrain/${code}`;
        return this.load().then(() => {
            this.records.delete(key);
            this.memoryOnly.delete(key);
            if (!this.db) return;
            return new Promise((resolve) => {
                const tx = this.db.transaction('files', 'readwrite');
                tx.oncomplete = resolve;
                tx.onabort = resolve;
                tx.objectStore('files').delete(key);
            }).catch(() => {});
        });
    }
}

export default new NavDataCache();
