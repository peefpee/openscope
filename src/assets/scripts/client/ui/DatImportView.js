import $ from 'jquery';
import navData from '../airport/dat/NavDataCache';
import { readOpenAir } from '../airport/dat/parseOpenAir';
import parseMsaDat from '../airport/dat/parseMsaDat';
import AirportController from '../airport/AirportController';
import { parseAirportDat } from '../airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../airport/dat/buildDatScope';

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
    constructor($root, onMsaChange) {
        this.$dialog = $root.find('#dat-import');
        this.$toggle = $root.find('.toggle-dat-import');
        this.onMsaChange = onMsaChange;
        this.version = 0;
        this.pending = Promise.resolve();
        this.$toggle.on('click.datImport', () => {
            this.$dialog[0].showModal();
            this.update();
        });
        this.$dialog.on('keydown.datImport keyup.datImport', (event) => event.stopPropagation());
        this.$dialog.on('change.datImport', 'input[type=file]', (event) => {
            const { id, files } = event.target;
            const file = files[0];
            event.target.value = '';
            if (file) this.update(() => this.importFile(id, file));
        });
        this.$dialog.on('change.datImport', '#dat-cached-airport', (event) => {
            const key = event.target.value;
            this.update(() => { this.airport = navData.records.get(key); });
        });
        this.$dialog.on('click.datImport', '.dat-open', () => {
            if (this.scope) {
                if (this.scope.icao.startsWith('Y')) {
                    const name = this.$dialog.find('#dat-spoken-name').val().trim();
                    if (name !== (this.airport.spokenAirportName || this.scope.spokenAirportName || '')) {
                        this.airport = { ...this.airport, spokenAirportName: name };
                        navData.save(this.airport);
                    }
                    if (name) this.scope.spokenAirportName = name;

                    const controllerRadioNames = {
                        approach: this.$dialog.find('#dat-approach-radio-name').val().trim(),
                        departure: this.$dialog.find('#dat-departure-radio-name').val().trim(),
                        tower: this.$dialog.find('#dat-tower-radio-name').val().trim(),
                        centre: this.$dialog.find('#dat-centre-radio-name').val().trim()
                    };

                    if (Object.values(controllerRadioNames).some(Boolean)) {
                        this.airport = { ...this.airport, controllerRadioNames };
                        navData.save(this.airport);
                    }

                    Object.assign(this.scope, { controllerRadioNames });
                }
                AirportController.openImportedAirport(this.scope);
                this.$dialog[0].close();
            }
        });
    }

    // Serialize changes so a large fix file finishing late cannot replace a newer import.
    update(change) {
        this.version += 1;
        const { version } = this;
        this.scope = null;
        this.$dialog.find('footer').prop('hidden', true);
        this.$dialog.find('.dat-status').text('Reading navigation data…');
        this.pending = this.pending.then(() => navData.load()).then(change).then(() => {
            if (version === this.version) this.render();
        }).catch((error) => {
            if (version === this.version) {
                this.$dialog.find('.dat-results').empty();
                this.$dialog.find('.dat-status').text(error.message);
            }
        });
        return this.pending;
    }

    importFile(id, file) {
        if (id !== 'dat-airspace-file' && !/\.dat$/i.test(file.name)) throw new Error('Choose an X-Plane .dat file.');
        return readFile(file).then((text) => {
            const cycle = /data cycle (\d{4})/i.exec(text.slice(0, 1024));
            const record = { name: file.name, cycle: cycle ? cycle[1] : '' };
            if (id === 'dat-airspace-file') {
                return navData.save({ ...record, key: 'au-airspace', ...readOpenAir(text) });
            }
            if (id === 'dat-airport-file') {
                const data = parseAirportDat(text, file.name);
                const key = `airport/${data.icao}`;
                this.airport = {
                    ...navData.records.get(key), ...record, key, text
                };
                if (data.icao) return navData.save(this.airport);
            } else if (id === 'dat-msa-file') {
                return navData.save({ ...record, key: 'msa', airports: parseMsaDat(text) }).then(this.onMsaChange);
            } else {
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
            }
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
            airspace.warnings.forEach((warning) => details.append($('<p>').text(warning)));
            this.$dialog.find('.dat-airspace-source').append(details);
        }
        this.$dialog.find('.dat-cache-status').text(navData.memoryOnly.size || !navData.db ?
            'Browser storage is unavailable for some files. Those files are available for this session only.' :
            'Imports are saved in this browser. Airports share the waypoint and MSA files.');
        const $status = this.$dialog.find('.dat-status');
        const $results = this.$dialog.find('.dat-results').empty();
        if (!this.airport) {
            $status.text('Choose an airport to preview its scope.');
            return;
        }
        const data = parseAirportDat(this.airport.text, this.airport.name);
        const fixes = navData.records.get('fixes');
        const waypoints = resolveWaypoints(data, fixes && fixes.text);
        this.scope = buildDatScope(data, waypoints);
        this.$dialog.find('.dat-spoken-name').prop('hidden', !this.scope || !data.icao.startsWith('Y'));
        const spokenAirportName = this.airport.spokenAirportName ||
            (this.scope && this.scope.spokenAirportName) || '';

        this.$dialog.find('#dat-spoken-name').val(spokenAirportName);
        const controllerNames = this.airport.controllerRadioNames || {};
        this.$dialog.find('.dat-controller-names').prop('hidden', !this.scope || !data.icao.startsWith('Y'));
        for (const [key, selector] of Object.entries({
            approach: '#dat-approach-radio-name',
            departure: '#dat-departure-radio-name',
            tower: '#dat-tower-radio-name',
            centre: '#dat-centre-radio-name'
        })) {
            this.$dialog.find(selector).val(controllerNames[key] || '');
        }
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
        $status.text(status.join(' '));
        this.$dialog.find('footer').prop('hidden', !this.scope);
    }

    destroy() {
        this.version += 1;
        this.$toggle.off('.datImport');
        this.$dialog.off('.datImport');
    }
}
