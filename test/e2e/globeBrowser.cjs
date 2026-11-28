// Real-browser Playwright verification for Unified Airport Catalogue & 3D Globe
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const playwright = require('playwright');

const root = path.resolve(__dirname, '../../public');
const shotsDir = path.resolve(__dirname, '../../documentation/screenshots');
const origin = 'http://localhost';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const YMHB_DAT = [
    '1    13 1 0 YMHB Hobart',
    '100 45.00 1 0 0.25 0 2 0 12 -42.83311100 147.50344400 0 0 3 0 0 0 30 -42.84355600 147.52158300 0 0 3 0 0 0',
    '99'
].join('\n');

for (const engine of (process.env.BROWSERS || 'chromium,webkit').split(',')) {
    test(`${engine} classic 3D globe, saved import migration, filtering, unsave, fallback, and screenshots`, async () => {
        await fs.mkdir(shotsDir, { recursive: true });
        const browser = await playwright[engine].launch();
        try {
            const context = await browser.newContext({
                viewport: { width: 1280, height: 800 },
                reducedMotion: 'reduce'
            });
            await context.route('**/*', async (route) => {
                const url = new URL(route.request().url());
                if (url.origin !== origin) return route.abort();
                const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
                try {
                    const body = await fs.readFile(file);
                    await route.fulfill({ body, contentType: mime[path.extname(file)] || 'application/octet-stream' });
                } catch {
                    await route.abort().catch(() => {});
                }
            });

            const page = await context.newPage();
            await page.goto(origin);

            // Seed IndexedDB openscope-navdata with a saved YMHB airport to test auto-migration
            await page.evaluate((datText) => new Promise((resolve, reject) => {
                const req = window.indexedDB.open('openscope-navdata', 1);
                req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'key' });
                req.onerror = () => reject(req.error);
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('files', 'readwrite');
                    tx.objectStore('files').put({
                        key: 'airport/YMHB',
                        name: 'YMHB.dat',
                        cycle: '2609',
                        text: datText,
                        importedAt: '2026-11-28T00:00:00.000Z'
                    });
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                };
            }), YMHB_DAT);

            await page.reload();
            const menu = page.locator('#session-menu');
            const action = (name) => menu.locator(`[data-page]:visible [data-action="${name}"]`).click();

            await action('play');
            await action('classic');
            await menu.locator('[data-page="classic"]').waitFor({ state: 'visible' });
            await page.locator('.globe-marker[data-icao="YSSY"]').waitFor({ state: 'visible' });
            await page.locator('.globe-marker[data-icao="YMHB"]').waitFor({ state: 'visible' });

            if (engine === 'chromium') {
                await page.screenshot({ path: path.join(shotsDir, '01-initial-classic-globe.png') });
            }

            // Select bundled YSSY marker
            await page.locator('.globe-marker[data-icao="YSSY"]').click();
            assert.equal(await page.locator('#session-selected-icao').textContent(), 'YSSY');
            if (engine === 'chromium') {
                await page.screenshot({ path: path.join(shotsDir, '02-selected-bundled-airport.png') });
            }

            // Select saved imported YMHB marker
            await page.locator('.globe-marker[data-icao="YMHB"]').click();
            assert.equal(await page.locator('#session-selected-icao').textContent(), 'YMHB');
            assert.equal(await page.locator('[data-action="unsave"]').isVisible(), true);
            if (engine === 'chromium') {
                await page.screenshot({ path: path.join(shotsDir, '03-selected-saved-imported-airport.png') });
                await page.locator('.menu-radar-preview').screenshot({
                    path: path.join(shotsDir, '04-imported-airport-runway-preview.png')
                });
            }

            // Unsave confirmation screenshot + confirm unsave
            await action('unsave');
            await page.locator('#session-unsave-confirm').waitFor({ state: 'visible' });
            if (engine === 'chromium') {
                await page.screenshot({ path: path.join(shotsDir, '05-unsave-confirmation.png') });
            }
            await action('unsaveConfirm');
            await page.locator('.globe-marker[data-icao="YMHB"]').waitFor({ state: 'detached' });

            // Empty saved-airport filter
            await page.locator('button[data-filter="saved"]').click();
            await page.locator('#session-globe-empty').waitFor({ state: 'visible' });
            if (engine === 'chromium') {
                await page.screenshot({ path: path.join(shotsDir, '06-empty-saved-airport-filter.png') });
            }

            // Reset filter, select YSSY, and proceed to Session Setup
            await page.locator('button[data-filter="all"]').click();
            await page.locator('.globe-marker[data-icao="YSSY"]').click();
            await action('configure');
            await menu.locator('[data-page="setup"]').waitFor({ state: 'visible' });
            if (engine === 'chromium') {
                await page.screenshot({ path: path.join(shotsDir, '07-session-setup-from-globe.png') });
            }

            // Verify back navigation preserves Classic globe
            await action('selection');
            await menu.locator('[data-page="classic"]').waitFor({ state: 'visible' });
            await page.locator('.globe-marker[data-icao="YSSY"]').waitFor({ state: 'visible' });

            // Verify WebGL fallback mode renders accessible airport cards
            await page.evaluate(() => {
                document.getElementById('session-airport-globe').classList.add('is-fallback');
            });
            await page.locator('#session-airport-cards .menu-airport-card[data-icao="yssy"]').waitFor({ state: 'visible' });
        } finally {
            await browser.close();
        }
    });
}
