import 'regenerator-runtime/runtime';
import test from 'ava';
import { NavDataCache } from '../../src/assets/scripts/client/airport/dat/NavDataCache';

test('a failed write remains usable for the session and a successful retry clears its warning', (t) => {
    const cache = new NavDataCache();
    cache.ready = Promise.resolve();
    let quotaExceeded = true;
    const record = { key: 'msa', cycle: '2604', airports: {} };
    cache.db = {
        transaction() {
            const tx = {
                objectStore: () => ({
                    put(value) {
                        t.is(value, record);
                        setImmediate(() => quotaExceeded ? tx.onabort() : tx.oncomplete());
                    }
                })
            };
            return tx;
        }
    };
    return cache.save(record).then(() => {
        t.is(cache.records.get('msa'), record);
        t.true(cache.memoryOnly.has('msa'));
        quotaExceeded = false;
        return cache.save(record);
    }).then(() => {
        t.false(cache.memoryOnly.has('msa'));
    });
});

test('terrain writes prune persistent records and invalidate changed generation settings', async (t) => {
    const disk = new Map();
    const cache = new NavDataCache();
    cache.ready = Promise.resolve();
    cache.db = {
        transaction() {
            const tx = {};
            const store = {
                put: (record) => disk.set(record.key, record),
                delete: (key) => disk.delete(key),
                getAll() {
                    const request = { result: [...disk.values()] };
                    setImmediate(() => { request.onsuccess(); tx.oncomplete(); });
                    return request;
                }
            };
            tx.objectStore = () => store;
            return tx;
        }
    };
    for (let i = 0; i < 12; i++) {
        await cache.saveTerrain({ icao: 'Y' + i, geojson: {}, generatedAt: new Date(i).toISOString() });
    }
    t.deepEqual([...disk.keys()], [...cache.records.keys()]);
    t.is(disk.size, 10);
    t.false(disk.has('terrain/Y0'));
    const reloaded = new NavDataCache();
    reloaded.records = new Map(disk);
    t.truthy(reloaded.getTerrain('Y11', { resolution: '21x21' }));
    for (const query of [{ resolution: '25x25' }, { coverageNm: 80 }, { coordinates: [0, 0] }, { contourIntervalFt: 500 }]) {
        t.is(reloaded.getTerrain('Y11', query), null);
    }
});
