// Run against the production build with Playwright available on the Node module path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const playwright = require('playwright');

const root = path.resolve(__dirname, '../../public');
const origin = 'http://localhost';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

for (const engine of (process.env.BROWSERS || 'chromium,webkit').split(',')) {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
        test(`${engine} at ${viewport.width}x${viewport.height} navigates, recovers and restarts`, async () => {
            const browser = await playwright[engine].launch();
            try {
                const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
                let assetFailure = false;
                let heldResponse;
                await context.route('**/*', async (route) => {
                    const url = new URL(route.request().url());
                    if (url.origin !== origin) return route.abort();
                    if (url.pathname.endsWith('/airlines.json')) {
                        if (assetFailure) return route.fulfill({ status: 503, body: '' });
                        if (heldResponse) await heldResponse;
                    }
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
                const menu = page.locator('#session-menu');
                const action = (name) => menu.locator('[data-page]:visible [data-action="' + name + '"]').click();
                const only = async (name) => {
                    await menu.locator('[data-page="' + name + '"]').waitFor({ state: 'visible' });
                    assert.deepEqual(await menu.locator('[data-page]:visible').evaluateAll((els) => els.map((el) => el.dataset.page)), [name]);
                    assert.ok(await menu.locator('[data-page][hidden]').evaluateAll((els) => els.every((el) => {
                        const control = el.querySelector('input,button,select');
                        if (control) control.focus();
                        return !el.contains(document.activeElement) && el.getClientRects().length === 0 && el.inert;
                    })));
                };
                await only('home');
                await action('settings');
                await page.locator('#voice-enabled').setChecked(true);
                await page.reload();
                await action('settings');
                assert.equal(await page.locator('#voice-enabled').isChecked(), true);
                await action('settingsBack');
                await action('play');
                await only('modes');
                await action('custom');
                await page.locator('#dat-import[open]').waitFor();
                await page.keyboard.press('Escape');
                await only('modes');
                await action('classic');
                await only('classic');
                await page.locator('#session-airport option[value=yssy]').waitFor({ state: 'attached' });
                const card = page.locator('.menu-airport-card[data-icao=yssy]');
                if (await card.isVisible()) await card.click();
                else await page.locator('#session-airport').selectOption('yssy');
                await action('configure');
                await only('setup');
                await page.locator('#session-departures').check();
                await action('selection');
                await action('configure');
                await only('setup');
                assert.equal(await page.locator('#session-departures').isChecked(), true);
                assetFailure = true;
                await action('start');
                await only('setup');
                assert.ok(await page.locator('#session-error').textContent());
                assetFailure = false;
                let release;
                heldResponse = new Promise((resolve) => { release = resolve; });
                const request = page.waitForRequest('**/airlines.json');
                await action('start');
                await request;
                await only('loading');
                await action('cancel');
                release();
                heldResponse = null;
                await only('setup');
                assert.equal(await page.locator('iframe').count(), 0);
                for (let session = 0; session < 2; session++) {
                    await page.locator('[data-action=start]').evaluate((start) => { start.click(); start.click(); });
                    await menu.waitFor({ state: 'hidden' });
                    assert.equal(await page.locator('iframe').count(), 1);
                    await page.keyboard.press('Escape');
                    await only('pause');
                    await action('settings');
                    await action('settingsBack');
                    await action('resume');
                    await page.keyboard.press('Escape');
                    await only('pause');
                    await action('confirm');
                    await action('exit');
                    await only('home');
                    assert.equal(await page.locator('iframe').count(), 0);
                    if (!session) {
                        await action('play');
                        await action('classic');
                        await action('configure');
                        await only('setup');
                        assert.equal(await page.locator('#session-departures').isChecked(), false);
                    }
                }
            } finally {
                await browser.close();
            }
        });
    }
}
