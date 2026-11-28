const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const colors = require('ansi-colors');

const app = express();
const server = http.Server(app);

const PORT = process.env.PORT || 3003;

app.use('/assets', express.static(path.join(__dirname, '/../../../assets')));

function fetchJson(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: timeoutMs }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                return reject(new Error(`Upstream HTTP ${res.statusCode}`));
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error('Terrain request timed out'));
        });
        req.on('error', reject);
    });
}

app.get('/api/terrain', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const icao = String(req.query.icao || 'IMPORT').toUpperCase();
    const coverageNm = Math.min(100, Math.max(10, Number(req.query.coverageNm) || 60));
    const intervalFt = Math.min(5000, Math.max(250, Number(req.query.intervalFt) || 1000));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return res.status(400).json({ error: 'Valid lat and lon query parameters are required' });
    }

    try {
        const dLat = coverageNm / 60;
        const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
        const dLon = coverageNm / (60 * cosLat);
        const minLat = lat - dLat;
        const maxLat = lat + dLat;
        const minLon = lon - dLon;
        const maxLon = lon + dLon;
        const gridSize = Number(req.query.gridSize || 21);
        if (![11, 21, 25].includes(gridSize)) return res.status(400).json({ error: 'Unsupported grid size' });

        const lats = [];
        const lons = [];
        for (let r = 0; r < gridSize; r++) {
            const rowLat = minLat + (maxLat - minLat) * r / (gridSize - 1);
            for (let c = 0; c < gridSize; c++) {
                const colLon = minLon + (maxLon - minLon) * c / (gridSize - 1);
                lats.push(rowLat.toFixed(5));
                lons.push(colLon.toFixed(5));
            }
        }

        const elevations = [];
        for (let i = 0; i < lats.length; i += 100) {
            const batchLats = lats.slice(i, i + 100).join(',');
            const batchLons = lons.slice(i, i + 100).join(',');
            const url = `https://api.open-meteo.com/v1/elevation?latitude=${batchLats}&longitude=${batchLons}`;
            const json = await fetchJson(url);
            if (!json || !Array.isArray(json.elevation)) {
                throw new Error('Malformed upstream elevation response');
            }
            elevations.push(...json.elevation);
        }

        return res.json({
            icao,
            coverageNm,
            intervalFt,
            gridSize,
            bounds: { minLat, maxLat, minLon, maxLon },
            elevations,
            provider: 'open-meteo',
            attribution: 'Copernicus DEM GLO-90 via Open-Meteo (CC BY 4.0)'
        });
    } catch (err) {
        return res.status(502).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/../../../index.html'));
});

server.listen(PORT, () => {
    console.log(colors.green.bold(`\nListening on PORT ${PORT}`));
});
