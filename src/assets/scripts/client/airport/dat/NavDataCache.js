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
                    const tx = db.transaction('files', 'readonly');
                    const all = tx.objectStore('files').getAll();
                    tx.onabort = () => { db.close(); reject(tx.error); };
                    tx.oncomplete = () => {
                        all.result.forEach((record) => this.records.set(record.key, record));
                        this.db = db;
                        db.onversionchange = () => { db.close(); this.db = null; };
                        resolve();
                    };
                };
            }).catch(() => { this.db = null; });
        }
        return this.ready;
    }

    save(record) {
        return this.load().then(() => {
            this.records.set(record.key, record);
            this.memoryOnly.add(record.key);
            if (!this.db) return;
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('files', 'readwrite');
                tx.oncomplete = resolve;
                tx.onabort = () => reject(tx.error);
                tx.objectStore('files').put(record);
            }).then(() => {
                if (this.records.get(record.key) === record) this.memoryOnly.delete(record.key);
            }).catch(() => {
                // The importer reports this record as session-only on quota or storage failure.
            });
        });
    }
}

export default new NavDataCache();
