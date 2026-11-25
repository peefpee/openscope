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
