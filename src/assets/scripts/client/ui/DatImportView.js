import $ from 'jquery';
import { getAustralianControllerPreset } from '../constants/controllerConstants';
import navData from '../airport/dat/NavDataCache';
import { importOpenAir } from '../airport/dat/parseOpenAir';
import parseMsaDat from '../airport/dat/parseMsaDat';
import { parseAirportDat } from '../airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../airport/dat/buildDatScope';
import { fetchAndGenerateTerrain } from '../airport/dat/terrainGenerator';
import { markImportedAirportSaved } from '../session/airportCatalogue';

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsText(file);
    });
}

function section(title) {
    return $('<details>').append($('<summary>').text(title));
}

function renderDetails($results, data) {
    $results.empty();
    const $runways = section(`Runway thresholds (${data.runways.size})`);
    for (const { id, position } of data.runways.values()) {
        const [lat, lon, elevation] = position;
        $runways.append($('<p>').text(`${id} · ${lat.toFixed(5)}, ${lon.toFixed(5)} · ${elevation} ft`));
    }
    $results.append($runways);

    const labels = { SID: 'SIDs', STAR: 'STARs', APPCH: 'Approaches' };
    for (const [kind, procedures] of Object.entries(data.procedures)) {
        const $group = section(`${labels[kind]} (${procedures.size})`);
        for (const procedure of procedures.values()) {
            const $procedure = section(procedure.id);
            for (const branch of procedure.branches.values()) {
                const $branch = section(`${branch.transition || 'Common route'} · type ${branch.type}`);
                const $legs = $('<ol>');
                for (const leg of branch.legs) {
                    const parts = [
                        leg.path,
                        leg.fix,
                        leg.course !== null && `${leg.course}°`,
                        leg.altitude && `ALT ${leg.altitude}`,
                        leg.speed && `SPD ${leg.speed}`
                    ];
                    $legs.append($('<li>').text(parts.filter(Boolean).join(' · ')));
                }
                $procedure.append($branch.append($legs));
            }
            $group.append($procedure);
        }
        $results.append($group);
    }

    if (data.warnings.length) {
        const $warnings = section(`Import warnings (${data.warnings.length})`);
        data.warnings.forEach((warning) => $warnings.append($('<p>').text(warning)));
        $results.append($warnings);
    }
}

export default class DatImportView {
    constructor($root, onMsaChange, onPrepared) {
        this.$dialog = $root.find('#dat-import');
        this.setStatus('idle');
        this.$dialog.on('dragover.datImport drop.datImport', (event) => {
            event.preventDefault();
            if (event.type !== 'drop') return;
            const zone = event.target.closest('[data-import-target]');
            const id = zone ? zone.dataset.importTarget : 'dat-airport-file';
            const file = event.originalEvent.dataTransfer.files[0];
            if (!file || !this.$dialog.find('input[type=file]').toArray().some((input) => input.id === id)) return;
            if (id === 'dat-terrain-file') this.importTerrainGeoJson(file);
            else this.update(() => this.importFile(id, file));
        });
        this.onMsaChange = onMsaChange;
        this.version = 0;
        this.revision = 0;
        this.workflow = 0;
        this.pending = Promise.resolve();
        this._terrainAbort = null;
        this.$dialog.on('keydown.datImport keyup.datImport', (event) => event.stopPropagation());
        this.$dialog.on('change.datImport', 'input[type=file]', (event) => {
            const { id, files } = event.target;
            const file = files[0];
            event.target.value = '';
            if (file) {
                if (id === 'dat-terrain-file') {
                    this.importTerrainGeoJson(file);
                } else {
                    this.update(() => this.importFile(id, file));
                }
            }
        });
        this.$dialog.on('click.datImport', '.dat-terrain-regen', () => {
            if (this.scope) {
                this._loadOrGenerateTerrain(this.scope, { force: true });
            }
        });
        this.$dialog.on('click.datImport', '.dat-terrain-clear', () => {
            if (this.scope) {
                if (this._terrainAbort) this._terrainAbort.abort();
                this._terrainAbort = null;
                this.setStatus('ready');
                this.scope.terrainGeoJson = null;
                this.scope.has_terrain = false;
                navData.clearTerrain(this.scope.icao);
                this.$dialog.find('.dat-terrain-status').text(`Cleared cached terrain for ${this.scope.icao}.`);
            }
        });
        const terrainControls = '#dat-terrain-coverage, #dat-terrain-provider, #dat-terrain-grid, #dat-terrain-auto';
        this.$dialog.on('change.datImport', terrainControls, () => {
            if (this.scope) {
                this._loadOrGenerateTerrain(this.scope, { force: false });
            }
        });
        this.$dialog.on('change.datImport', '#dat-cached-airport', (event) => {
            const key = event.target.value;
            this.update(() => { this.selectedRunway = null; this.airport = navData.records.get(key); });
        });
        this.$dialog.on('change.datImport', '#dat-runway', (event) => {
            this.selectedRunway = event.target.value;
            this.revision += 1;
            this.update();
        });
        this.$dialog.on('click.datImport', '.dat-open', () => {
            if (this.scope) {
                const spokenName = this.$dialog.find('#dat-spoken-name').val().trim();
                const centreSector = this.$dialog.find('#dat-centre').val();
                this.scope.spokenAirportName = spokenName;
                this.scope.centreSector = centreSector;
                if (this.airport && this.airport.key) {
                    this.airport.spokenAirportName = spokenName;
                    this.airport.selectedRunway = this.selectedRunway || this.scope.arrivalRunway;
                    this.airport.controllerSettings = {
                        ...(this.airport.controllerSettings || {}),
                        centreSector
                    };
                    navData.save(this.airport).then(() => {
                        if (!navData.memoryOnly.has(this.airport.key) && navData.db) {
                            markImportedAirportSaved(this.scope.icao);
                        }
                        this.$dialog[0].dispatchEvent(new CustomEvent('catalogue-updated', { bubbles: true }));
                    });
                }
                onPrepared(this.scope);
                this.$dialog[0].close();
            }
        });
    }

    setStatus(state, message = '') {
        this.$dialog[0].dataset.importStatus = state;
        this.$dialog[0].dispatchEvent(new CustomEvent('import-status', { detail: { state, message } }));
    }

    // Serialize changes so a large fix file finishing late cannot replace a newer import.
    update(change) {
        this.version += 1;
        const { version } = this;
        if (change) this.revision += 1;
        this.setStatus('reading');
        this.scope = null;
        this.$dialog.find('footer').prop('hidden', true);
        this.$dialog.find('.dat-status').text('Reading navigation data…');
        const { workflow } = this;
        this.pending = this.pending.then(() => navData.load()).then(() => {
            if (workflow === this.workflow && change) return change();
        }).then(() => {
            if (version === this.version) this.render();
        }).catch((error) => {
            if (version === this.version) {
                this.setStatus('error', error.message);
                this.$dialog.find('.dat-results').empty();
                this.$dialog.find('.dat-status').text(error.message);
            }
        });
        return this.pending;
    }

    importFile(id, file) {
        if (id !== 'dat-airspace-file' && !/\.dat$/i.test(file.name)) throw new Error('Choose an X-Plane .dat file.');
        const { workflow } = this;
        return readFile(file).then((text) => {
            if (workflow !== this.workflow) return;
            this.setStatus('parsing');
            const cycle = /data cycle (\d{4})/i.exec(text.slice(0, 1024));
            const record = { name: file.name, cycle: cycle ? cycle[1] : '' };
            if (id === 'dat-airspace-file') {
                return importOpenAir(text).then((result) => navData.save({ ...record, key: 'au-airspace', ...result }));
            }
            if (id === 'dat-airport-file') {
                const data = parseAirportDat(text, file.name);
                this.setStatus('validating');
                const key = `airport/${data.icao}`;
                if (!/^Y[A-Z0-9]{3}$/.test(data.icao) || !buildDatScope(data, resolveWaypoints(data))) {
                    throw new Error('Choose an Australian airport DAT with reciprocal runway thresholds.');
                }
                this.selectedRunway = null;
                this.airport = {
                    ...navData.records.get(key),
                    ...record,
                    key,
                    text,
                    importedAt: new Date().toISOString()
                };
                return navData.save(this.airport).then(() => {
                    if (!navData.memoryOnly.has(key) && navData.db) {
                        markImportedAirportSaved(data.icao);
                    }
                    this.$dialog[0].dispatchEvent(new CustomEvent('catalogue-updated', { bubbles: true }));
                });
            } else if (id === 'dat-msa-file') {
                return navData.save({ ...record, key: 'msa', airports: parseMsaDat(text) }).then(this.onMsaChange);
            }
            // Accept legacy five-column fix files, including headerless extracts.
            const fixFilePattern = new RegExp(
                '^\\s*[+-]?\\d+(?:\\.\\d+)?[ \\t]+[+-]?\\d+(?:\\.\\d+)?[ \\t]+' +
                    '[A-Z0-9]+[ \\t]+(?:ENRT|[A-Z0-9]{4})[ \\t]+[A-Z0-9]{2}(?:[ \\t]|\\r?$)',
                'm'
            );

            if (!fixFilePattern.test(text)) {
                throw new Error('No waypoint coordinates found. Choose an X-Plane earth_fix.dat file.');
            }
            return navData.save({ ...record, key: 'fixes', text });
        });
    }

    render() {
        const $select = this.$dialog.find('#dat-cached-airport').empty();
        const airports = [...navData.records.keys()].filter((key) => key.startsWith('airport/')).sort();
        $select.append($('<option>').val('').text('Choose a saved airport'));
        for (const key of airports) $select.append($('<option>').val(key).text(key.slice(8)));
        if (!this.airport && airports.length === 1) this.airport = navData.records.get(airports[0]);
        $select.val(this.airport ? this.airport.key : '');
        this.$dialog.find('.dat-cached').prop('hidden', !airports.length);
        const sourceSelectors = {
            fixes: '.dat-fix-source',
            msa: '.dat-msa-source',
            'au-airspace': '.dat-airspace-source'
        };

        for (const [key, selector] of Object.entries(sourceSelectors)) {
            const record = navData.records.get(key);
            this.setStatus('parsing');
            const cycle = record && record.cycle ? ` · AIRAC ${record.cycle}` : '';

            this.$dialog.find(selector).text(record ? `In use: ${record.name}${cycle}` : '');
        }
        const airspace = navData.records.get('au-airspace');
        if (airspace && airspace.warnings) {
            const classes = [...new Set(airspace.regions.map((area) => area.airspace_class || area.type))];
            const summary = `${airspace.regions.length} imported · ${airspace.rejected} rejected · ` +
                `${airspace.approximated} curved boundaries approximated`;
            const details = section(summary);
            details.append($('<p>').text(`Classes and types: ${classes.join(', ')}. Regional coverage unverified.`));
            const cycles = [...new Set([...navData.records.values()].map((record) => record.cycle).filter(Boolean))];
            if (cycles.length > 1) {
                details.append($('<p>').text(`Imported navigation files use different AIRAC cycles: ${cycles.join(', ')}.`));
            }
            if (!airspace.cycle) details.append($('<p>').text('Airspace AIRAC cycle unknown.'));
            airspace.warnings.forEach((warning) => details.append($('<p>').text(warning)));
            this.$dialog.find('.dat-airspace-source').append(details);
        }
        this.$dialog.find('.dat-cache-status').text(navData.memoryOnly.size || !navData.db ?
            'Browser storage is unavailable for some files. Those files are available for this session only.' :
            'Imports are saved in this browser. Airports share the waypoint and MSA files.');
        const $status = this.$dialog.find('.dat-status');
        const $results = this.$dialog.find('.dat-results').empty();
        if (!this.airport) {
            this.setStatus('idle');
            $status.text('Choose an airport to preview its scope.');
            return;
        }
        const data = parseAirportDat(this.airport.text, this.airport.name);
        const fixes = navData.records.get('fixes');
        const waypoints = resolveWaypoints(data, fixes && fixes.text);
        this.scope = buildDatScope(data, waypoints, this.selectedRunway);
        if (this.scope) {
            const { scope } = this;
            const preset = getAustralianControllerPreset(scope.icao);
            const options = this.$dialog.find('#dat-runway').empty();
            scope.runways.forEach((pair) => pair.name.forEach((name) => options.append($('<option>').text(name))));
            options.val(scope.arrivalRunway);
            this.$dialog.find('#dat-spoken-name').val(this.airport.spokenAirportName || scope.spokenAirportName || '');
            this.$dialog.find('#dat-centre').val((this.airport.controllerSettings || {}).centreSector ||
                (preset && preset.centre[0].sectorId) || 'YMMM');
            scope.controllerRadioNames = this.airport.controllerRadioNames;
            scope.importControllerSettings = this.airport.controllerSettings;
        }
        if (this.scope && this.airport.spokenAirportName) this.scope.spokenAirportName = this.airport.spokenAirportName;
        renderDetails($results, data);
        const count = `${waypoints.total - waypoints.missing} of ${waypoints.total} named fixes located`;
        const status = [`${data.icao || this.airport.name} · ${count}.`];
        if (this.scope) {
            const sidCount = Object.keys(this.scope.sids).length;
            const starCount = Object.keys(this.scope.stars).length;
            status.push(`Available for clearance: ${sidCount}/${data.procedures.SID.size} SIDs and ` +
                `${starCount}/${data.procedures.STAR.size} STARs.`);
            const vectors = [...new Set(Object.values(this.scope.routeLabels))];
            if (vectors.length) {
                status.push(`Using ${vectors.join(' and ').toLowerCase()} on runway ${this.scope.arrivalRunway}.`);
            }
        }
        if (waypoints.missing) {
            if (!fixes) status.push('Add the matching earth_fix.dat to locate procedure fixes.');
            status.push('Incomplete routes remain available for inspection.');
        }
        if (!data.icao) {
            status.push('Name the file with its four-character airport code to open the scope.');
        } else if (!this.scope) {
            status.push('A pair of reciprocal runway thresholds is required to open the scope.');
        }
        this.setStatus(this.scope ? 'ready' : 'warning', status.join(' '));
        $status.text(status.join(' '));
        this.$dialog.find('.dat-terrain-section').prop('hidden', !this.scope);
        this.$dialog.find('footer').prop('hidden', !this.scope);
        if (this.scope) {
            this._loadOrGenerateTerrain(this.scope, { force: false });
        }
    }

    _resolveTerrainCoverageNm(scope) {
        const val = this.$dialog.find('#dat-terrain-coverage').val();
        if (val === 'auto') {
            const radiusKm = scope.ctr_radius || 74;
            return Math.min(80, Math.max(40, Math.ceil((radiusKm / 1.852) * 1.25 / 10) * 10));
        }
        return Number(val) || 60;
    }

    importTerrainGeoJson(file) {
        if (!this.scope) return;
        const targetScope = this.scope;
        const targetIcao = this.scope.icao;
        readFile(file).then((text) => {
            const geojson = JSON.parse(text);
            if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
                throw new Error('Invalid GeoJSON FeatureCollection.');
            }
            if (this.scope !== targetScope) return;
            if (this._terrainAbort) this._terrainAbort.abort();
            this._terrainAbort = null;
            this.setStatus('ready');
            this.scope.terrainGeoJson = geojson;
            this.scope.has_terrain = geojson.features.length > 0;
            const coverageNm = this._resolveTerrainCoverageNm(this.scope);
            navData.saveTerrain({
                icao: targetIcao,
                coordinates: this.scope.position,
                coverageNm,
                provider: 'manual',
                attribution: 'Manual GeoJSON upload',
                geojson
            });
            this.$dialog.find('.dat-terrain-status').text(`Loaded manual terrain (${geojson.features.length} features).`);
        }).catch((err) => {
            if (this.scope !== targetScope) return;
            this.setStatus('warning', err.message);
            this.$dialog.find('.dat-terrain-status').text(`Terrain upload failed: ${err.message}`);
        });
    }

    _loadOrGenerateTerrain(scope, { force = false } = {}) {
        if (!scope || !Array.isArray(scope.position)) return;
        const $terrainStatus = this.$dialog.find('.dat-terrain-status');
        const coverageNm = this._resolveTerrainCoverageNm(scope);
        const provider = this.$dialog.find('#dat-terrain-provider').val() || 'auto';
        const autoEnabled = this.$dialog.find('#dat-terrain-auto').prop('checked');
        const targetIcao = scope.icao;
        const gridSize = Number(this.$dialog.find('#dat-terrain-grid').val()) || 21;

        if (this._terrainAbort) {
            this._terrainAbort.abort();
            this._terrainAbort = null;
        }

        if (!force) {
            $terrainStatus.text(`Checking cached terrain for ${targetIcao}...`);
            const cached = navData.getTerrain(targetIcao, {
                coverageNm,
                coordinates: scope.position,
                provider,
                resolution: `${gridSize}x${gridSize}`,
                contourIntervalFt: 1000,
                datasetVersion: '1'
            });
            if (cached && cached.geojson) {
                scope.terrainGeoJson = cached.geojson;
                scope.has_terrain = cached.geojson.features.length > 0;
                this.setStatus('ready');
                $terrainStatus.text(`Terrain ready (cached): ${coverageNm} NM coverage.`);
                return;
            }
        }

        scope.terrainGeoJson = null;
        scope.has_terrain = false;
        this.setStatus('ready');
        if (!autoEnabled && !force) {
            $terrainStatus.text('Automatic terrain generation disabled.');
            return;
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        this._terrainAbort = controller;
        const { version } = this;

        this.setStatus('generating-terrain');
        fetchAndGenerateTerrain({
            icao: targetIcao,
            lat: scope.position[0],
            lon: scope.position[1],
            coverageNm,
            contourIntervalFt: 1000,
            gridSize,
            provider,
            signal: controller ? controller.signal : null,
            onProgress: (msg) => {
                if (version === this.version && this.scope && this.scope.icao === targetIcao) {
                    $terrainStatus.text(msg);
                }
            }
        }).then((result) => {
            if (version !== this.version || controller !== this._terrainAbort || this.scope !== scope) return;
            scope.terrainGeoJson = result.geojson;
            scope.has_terrain = true;
            navData.saveTerrain({
                icao: targetIcao,
                coordinates: scope.position,
                coverageNm,
                provider: result.provider,
                resolution: result.resolution,
                attribution: result.attribution,
                geojson: result.geojson
            });
            this.setStatus('ready');
            $terrainStatus.text(`Terrain ready: ${coverageNm} NM coverage (${result.attribution}).`);
        }).catch((err) => {
            if (err && err.name === 'AbortError') return;
            if (version !== this.version || controller !== this._terrainAbort || this.scope !== scope) return;
            this.setStatus('warning', err.message);
            $terrainStatus.text(`Terrain unavailable: ${err.message}. You can still open the scope without terrain.`);
        });
    }

    cancel() {
        this.workflow += 1;
        this.version += 1;
        if (this._terrainAbort) this._terrainAbort.abort();
    }

    destroy() {
        this.cancel();
        this.$dialog.off('.datImport');
    }
}
