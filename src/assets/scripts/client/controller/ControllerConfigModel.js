import {
    CONTROLLER_TYPE,
    FREQUENCY_SOURCE,
    HANDOFF_THRESHOLDS_NM,
    DEPARTURE_CONTACT_ALTITUDE_AGL,
    DEPARTURE_CONTACT_MIN_AGL,
    normalizeFrequency,
    frequencyToKhz,
    isAustralianAirport,
    resolveControllerRadioName,
    deriveAustralianControllerCallsign
} from '../constants/controllerConstants';
import { FLIGHT_RULES } from '../constants/aircraftConstants';
import DynamicPositionModel from '../base/DynamicPositionModel';
import { radiansToDegrees } from '../utilities/unitConverters';

const VALID_FREQUENCY_SOURCES = new Set(Object.values(FREQUENCY_SOURCE));

/**
 * Normalize a radian angle to degrees in [0, 360).
 *
 * @function radiansToNormalizedDegrees
 * @param {number} rad
 * @return {number}
 */
function radiansToNormalizedDegrees(rad) {
    const deg = radiansToDegrees(rad);
    return ((deg % 360) + 360) % 360;
}

/**
 * Check whether a bearing in degrees falls inside [minDeg, maxDeg], supporting wrap-around (e.g. [290, 90]).
 *
 * @function isBearingInRange
 * @param {number} bearingDeg
 * @param {number} minDeg
 * @param {number} maxDeg
 * @return {boolean}
 */
function isBearingInRange(bearingDeg, minDeg, maxDeg) {
    const b = ((bearingDeg % 360) + 360) % 360;
    const min = ((minDeg % 360) + 360) % 360;
    const max = ((maxDeg % 360) + 360) % 360;

    if (min <= max) {
        return b >= min && b <= max;
    }

    return b >= min || b <= max;
}

/**
 * Holds the per-airport controller configuration loaded from airport JSON
 * or synthesized with Australian fallback defaults for `Y*` / DAT airports.
 *
 * @class ControllerConfigModel
 */
export default class ControllerConfigModel {
    /**
     * @for ControllerConfigModel
     * @constructor
     * @param {Object|null} controllersJson - the `controllers` block from airport JSON, or null
     * @param {Object} [options={}]
     * @param {string} [options.icao]
     * @param {Object} [options.radio]
     * @param {Array} [options.runways]
     */
    constructor(controllersJson = null, options = {}) {
        /**
         * Airport ICAO code (uppercase) if known
         * @type {string|null}
         */
        this.icao = options.icao ? String(options.icao).trim().toUpperCase() : null;

        /**
         * Approach controller definition
         * @type {Object|null}
         */
        this.approach = null;

        /**
         * Departure controller definition (null if combined with approach or unconfigured)
         * @type {Object|null}
         */
        this.departure = null;

        /**
         * Tower controller definitions (may have multiple for different runways)
         * @type {Array<Object>}
         */
        this.tower = [];

        /**
         * Centre controller definitions (may have multiple sectors)
         * @type {Array<Object>}
         */
        this.centre = [];

        /**
         * Handoff threshold configuration (NM from runway threshold + optional deadlineSeconds)
         * @type {{ recommendedNm: number, urgentNm: number, mandatoryNm: number, deadlineSeconds: number|null }}
         */
        this.handoffThresholds = {
            recommendedNm: HANDOFF_THRESHOLDS_NM.RECOMMENDED,
            urgentNm: HANDOFF_THRESHOLDS_NM.URGENT,
            mandatoryNm: HANDOFF_THRESHOLDS_NM.MANDATORY,
            deadlineSeconds: null
        };

        /**
         * Departure contact altitude AGL configuration
         * @type {{ minAgl: number, targetAgl: number, transferDistanceNm: number|null }}
         */
        this.departureContactAltitudeAgl = {
            minAgl: DEPARTURE_CONTACT_MIN_AGL,
            targetAgl: DEPARTURE_CONTACT_ALTITUDE_AGL,
            transferDistanceNm: null
        };

        /**
         * VFR controlled airspace clearance boundary configuration
         * @type {Object}
         */
        this.vfrClearanceBoundaries = {
            enforceControlledShelves: true,
            boundaryBufferNm: 1.5,
            maxEntryAltitudeAgl: 1500,
            circuitAltitudeAgl: 1000,
            outerRadiusNm: 40,
            octaCeilingFt: null
        };

        /**
         * Frequency change approval (`fca`) eligibility rules
         * @type {Object}
         */
        this.fcaRules = {
            allowVfr: true,
            allowIfr: false,
            requireOutsideOrExitingControlledAirspace: true,
            exitBufferNm: 10,
            maxAltitudeFt: null
        };

        if (controllersJson) {
            this._parse(controllersJson, FREQUENCY_SOURCE.PUBLISHED);
        } else if (isAustralianAirport(this.icao)) {
            this._populateAustralianFallback(options);
        }
    }

    /**
     * Whether this airport has controller configuration
     * @type {boolean}
     */
    get hasControllerConfig() {
        return this.approach !== null ||
            this.departure !== null ||
            this.tower.length > 0 ||
            this.centre.length > 0;
    }

    /**
     * Get the first (primary) tower frequency
     * @type {string|null}
     */
    get primaryTowerFrequency() {
        if (this.tower.length === 0) {
            return null;
        }

        return this.tower[0].frequency;
    }

    /**
     * Get the first (primary) tower callsign
     * @type {string|null}
     */
    get primaryTowerCallsign() {
        if (this.tower.length === 0) {
            return null;
        }

        return this.tower[0].callsign;
    }

    /**
     * Get the first (primary) tower spoken radio name
     * @type {string|null}
     */
    get primaryTowerRadioName() {
        if (this.tower.length === 0) {
            return null;
        }

        return this.tower[0].radioName;
    }

    /**
     * Get the approach frequency
     * @type {string|null}
     */
    get approachFrequency() {
        if (!this.approach) {
            return null;
        }

        return this.approach.frequency;
    }

    /**
     * Get Approach controller entry
     *
     * @return {Object|null}
     */
    getApproach() {
        return this.approach ? { ...this.approach } : null;
    }

    /**
     * Get Departure controller entry (falls back to Approach if combined)
     *
     * @return {Object|null}
     */
    getDeparture() {
        if (this.departure) {
            return {
                ...this.departure,
                combinedWithApproach: false
            };
        }

        if (this.approach) {
            return {
                ...this.approach,
                combinedWithApproach: true
            };
        }

        return null;
    }

    /**
     * Find a controller entry by control position type.
     *
     * @param {string} type one of the CONTROLLER_TYPE values
     * @return {Object|null}
     */
    getControllerForType(type) {
        switch (type) {
            case CONTROLLER_TYPE.APP:
                return this.approach;
            case CONTROLLER_TYPE.DEP:
                return this.departure || this.approach;
            case CONTROLLER_TYPE.TWR:
                return this.tower.length > 0 ? this.tower[0] : null;
            case CONTROLLER_TYPE.CTR:
                return this.centre.length > 0 ? this.centre[0] : null;
            default:
                return null;
        }
    }

    /**
     * Find a controller entry by callsign or centre sector id.
     *
     * @param {string} callsign
     * @return {Object|null}
     */
    getControllerByCallsign(callsign) {
        if (!callsign || typeof callsign !== 'string') {
            return null;
        }

        const id = callsign.trim().toUpperCase();
        const allEntries = [
            this.approach,
            this.departure,
            ...this.tower,
            ...this.centre
        ].filter(Boolean);

        return allEntries.find((entry) => {
            const entryCallsign = String(entry.callsign || '').toUpperCase();
            const entrySector = String(entry.sectorId || '').toUpperCase();

            return entryCallsign === id || entrySector === id;
        }) || null;
    }

    /**
     * Resolve the spoken name of a controller entry using the central resolver.
     *
     * @param {Object|null} entry
     * @param {string} [type]
     * @return {string|null}
     */
    getRadioNameForController(entry, type = '') {
        if (!entry) {
            return null;
        }

        return resolveControllerRadioName({
            icao: this.icao,
            callsign: entry.callsign,
            sectorId: entry.sectorId,
            type: type || entry.role || '',
            radioName: entry.radioName,
            fallback: entry.fallbackRadioName
        });
    }

    /**
     * Find the best tower frequency for a given runway
     *
     * @param {string} runwayName
     * @return {Object|null}
     */
    getTowerForRunway(runwayName) {
        if (this.tower.length === 0) {
            return null;
        }

        if (!runwayName || typeof runwayName !== 'string') {
            return this.tower[0];
        }

        const uc = runwayName.trim().toUpperCase();

        for (let i = 0; i < this.tower.length; i++) {
            const twr = this.tower[i];

            if (!twr.runways || twr.runways.length === 0) {
                continue;
            }

            if (twr.runways.some((r) => r.toUpperCase() === uc)) {
                return twr;
            }
        }

        const wildcardTower = this.tower.find((twr) => !twr.runways || twr.runways.length === 0);

        if (wildcardTower) {
            return wildcardTower;
        }

        // Fall back to the primary tower
        return this.tower[0];
    }

    /**
     * Get all configured tower entries
     *
     * @return {Array<Object>}
     */
    getAllTowers() {
        return this.tower.map((t) => ({ ...t, runways: [...t.runways] }));
    }

    /**
     * Get the first centre sector
     *
     * @return {Object|null}
     */
    getPrimaryCentre() {
        if (this.centre.length === 0) {
            return null;
        }

        return this.centre[0];
    }

    /**
     * Get all configured centre sectors
     *
     * @return {Array<Object>}
     */
    getAllCentreSectors() {
        return this.centre.map((c) => ({ ...c }));
    }

    /**
     * Deterministically select the most appropriate Centre sector for an aircraft
     * using outbound/current waypoint, bearing from airport, altitude band, and default rules.
     *
     * @param {AircraftModel|null} aircraft
     * @param {AirportModel|null} airportModel
     * @return {Object|null}
     */
    selectCentreSector(aircraft, airportModel) {
        if (this.centre.length === 0) {
            return null;
        }

        if (this.centre.length === 1 || !aircraft) {
            return this.centre[0];
        }

        const fms = aircraft.fms || {};
        const outboundName = fms.outboundWaypoint && fms.outboundWaypoint.name ?
            String(fms.outboundWaypoint.name).toUpperCase() :
            null;
        const currentFixName = fms.currentWaypoint && fms.currentWaypoint.name ?
            String(fms.currentWaypoint.name).toUpperCase() :
            null;
        const altitude = Number.isFinite(aircraft.altitude) ? aircraft.altitude : null;

        // Filter by altitude rules if specified
        let candidates = this.centre;

        if (altitude !== null) {
            const altitudeMatches = this.centre.filter((sector) => {
                const { minAltitude, maxAltitude } = sector.rules || {};

                if (minAltitude != null && altitude < minAltitude) {
                    return false;
                }

                if (maxAltitude != null && altitude > maxAltitude) {
                    return false;
                }

                return true;
            });

            if (altitudeMatches.length > 0) {
                candidates = altitudeMatches;
            }
        }

        // Priority 1: Explicit waypoint match (outboundWaypoint or currentWaypoint)
        const waypointMatch = candidates.find((sector) => {
            const waypoints = sector.rules && sector.rules.waypoints;

            if (!waypoints || waypoints.length === 0) {
                return false;
            }

            return (outboundName && waypoints.includes(outboundName)) ||
                (currentFixName && waypoints.includes(currentFixName));
        });

        if (waypointMatch) {
            return waypointMatch;
        }

        // Compute magnetic bearing in degrees [0, 360)
        let bearingDeg = null;

        if (airportModel && airportModel.positionModel && aircraft.positionModel) {
            const distNm = airportModel.positionModel.distanceToPosition(aircraft.positionModel);

            if (distNm > 1) {
                bearingDeg = radiansToNormalizedDegrees(
                    airportModel.positionModel.bearingToPosition(aircraft.positionModel)
                );
            } else if (fms.outboundWaypoint && fms.outboundWaypoint.positionModel) {
                bearingDeg = radiansToNormalizedDegrees(
                    airportModel.positionModel.bearingToPosition(fms.outboundWaypoint.positionModel)
                );
            }
        }

        if (bearingDeg === null) {
            const trackRad = Number.isFinite(aircraft.groundTrack) ? aircraft.groundTrack : aircraft.heading;

            if (Number.isFinite(trackRad)) {
                bearingDeg = radiansToNormalizedDegrees(trackRad);
            }
        }

        // Priority 2: Bearing range match
        if (bearingDeg !== null) {
            const bearingMatch = candidates.find((sector) => {
                const ranges = sector.rules && sector.rules.bearingRanges;

                if (!ranges || ranges.length === 0) {
                    return false;
                }

                return ranges.some(([minDeg, maxDeg]) => isBearingInRange(bearingDeg, minDeg, maxDeg));
            });

            if (bearingMatch) {
                return bearingMatch;
            }
        }

        // Priority 3: Default sector fallback
        const defaultSector = candidates.find((sector) => sector.rules && sector.rules.default === true);

        return defaultSector || candidates[0];
    }

    /**
     * Get handoff distance & deadline thresholds
     *
     * @return {{ recommendedNm: number, urgentNm: number, mandatoryNm: number, deadlineSeconds: number|null }}
     */
    getHandoffThresholds() {
        return { ...this.handoffThresholds };
    }

    /**
     * Get departure contact altitude AGL settings
     *
     * @return {{ minAgl: number, targetAgl: number, transferDistanceNm: number|null }}
     */
    getDepartureContactAltitudeAgl() {
        return { ...this.departureContactAltitudeAgl };
    }

    /**
     * Get VFR clearance boundary configuration
     *
     * @return {Object}
     */
    getVfrClearanceBoundaries() {
        return { ...this.vfrClearanceBoundaries };
    }

    /**
     * Evaluate whether an aircraft is eligible for Frequency Change Approved (`fca`).
     * Returns `{ eligible, reason }` so callers can report clear pilot/ATC reasons.
     *
     * @param {AircraftModel} aircraft
     * @param {AirportModel} airportModel
     * @return {{ eligible: boolean, reason: string|null }}
     */
    evaluateFcaEligibility(aircraft, airportModel) {
        if (!aircraft) {
            return { eligible: false, reason: 'aircraft not found' };
        }

        if (typeof aircraft.isAirborne === 'function' && !aircraft.isAirborne()) {
            return { eligible: false, reason: 'unable while on the ground' };
        }

        if (typeof aircraft.isArrival === 'function' && aircraft.isArrival()) {
            return { eligible: false, reason: 'unable, arrivals require Tower handoff' };
        }

        if (aircraft.rules !== FLIGHT_RULES.VFR && !this.fcaRules.allowIfr) {
            return { eligible: false, reason: 'unable, IFR flights require Centre handoff' };
        }

        if (aircraft.rules === FLIGHT_RULES.VFR && !this.fcaRules.allowVfr) {
            return { eligible: false, reason: 'unable, VFR frequency change approval is not permitted' };
        }

        if (this.fcaRules.maxAltitudeFt != null && aircraft.altitude > this.fcaRules.maxAltitudeFt) {
            return { eligible: false, reason: 'unable, aircraft is above uncontrolled release altitude' };
        }

        if (this.fcaRules.requireOutsideOrExitingControlledAirspace &&
            airportModel &&
            typeof airportModel.isPointWithinAirspace === 'function' &&
            aircraft.positionModel) {
            const targetAlt = aircraft.rules === FLIGHT_RULES.VFR ?
                aircraft.altitude :
                Math.max(
                    aircraft.altitude || 0,
                    (aircraft.mcp && Number.isFinite(aircraft.mcp.altitude) && aircraft.mcp.altitude > 0) ?
                        aircraft.mcp.altitude :
                        (aircraft.altitude || 0)
                );
            const currentRelativePoint = airportModel.positionModel && aircraft.positionModel.gps ?
                DynamicPositionModel.calculateRelativePosition(
                    aircraft.positionModel.gps,
                    airportModel.positionModel,
                    airportModel.magneticNorth
                ) :
                aircraft.positionModel.relativePosition;

            if (currentRelativePoint && airportModel.isPointWithinAirspace(currentRelativePoint, targetAlt)) {
                return { eligible: false, reason: 'unable, inside controlled airspace' };
            }

            const trackRad = Number.isFinite(aircraft.groundTrack) ? aircraft.groundTrack : aircraft.heading;

            if (Number.isFinite(trackRad)) {
                const bufferNm = this.fcaRules.exitBufferNm != null ? this.fcaRules.exitBufferNm : 10;
                const sampleDistances = [...new Set([0, 2, 5, bufferNm, bufferNm + 10])]
                    .filter((distance) => Number.isFinite(distance) && distance >= 0)
                    .sort((a, b) => a - b);

                for (let i = 0; i < sampleDistances.length; i++) {
                    const forwardPos = aircraft.positionModel.generateDynamicPositionFromBearingAndDistance(
                        trackRad,
                        sampleDistances[i]
                    );
                    const relativePoint = airportModel.positionModel ?
                        DynamicPositionModel.calculateRelativePosition(
                            forwardPos.gps,
                            airportModel.positionModel,
                            airportModel.magneticNorth
                        ) :
                        forwardPos.relativePosition;

                    if (airportModel.isPointWithinAirspace(relativePoint, targetAlt)) {
                        const reason = sampleDistances[i] === 0 ?
                            'unable, inside controlled airspace' :
                            'unable, controlled airspace ahead';

                        return { eligible: false, reason };
                    }
                }
            }
        }

        return { eligible: true, reason: null };
    }

    /**
     * Boolean wrapper for `evaluateFcaEligibility`
     *
     * @param {AircraftModel} aircraft
     * @param {AirportModel} airportModel
     * @return {boolean}
     */
    isFcaEligible(aircraft, airportModel) {
        return this.evaluateFcaEligibility(aircraft, airportModel).eligible;
    }

    /**
     * Build the adjacent frequency list for display and UI panels
     *
     * @param {Object} [options={}]
     * @param {boolean} [options.includeLocal=false] - include APP and DEP entries
     * @return {Array<Object>}
     */
    getAdjacentFrequencyList(options = {}) {
        const list = [];

        if (options.includeLocal) {
            if (this.approach && this.approach.frequency !== null) {
                list.push({
                    role: CONTROLLER_TYPE.APP,
                    type: CONTROLLER_TYPE.APP,
                    callsign: this.approach.callsign,
                    radioName: this.approach.radioName,
                    frequency: this.approach.frequency,
                    frequencyKhz: this.approach.frequencyKhz,
                    sector: null,
                    runways: [],
                    source: this.approach.source,
                    isSimulated: this.approach.isSimulated,
                    isUserDefined: this.approach.isUserDefined
                });
            }

            if (this.departure && this.departure.frequency !== null) {
                list.push({
                    role: CONTROLLER_TYPE.DEP,
                    type: CONTROLLER_TYPE.DEP,
                    callsign: this.departure.callsign,
                    radioName: this.departure.radioName,
                    frequency: this.departure.frequency,
                    frequencyKhz: this.departure.frequencyKhz,
                    sector: null,
                    runways: [],
                    source: this.departure.source,
                    isSimulated: this.departure.isSimulated,
                    isUserDefined: this.departure.isUserDefined
                });
            }
        }

        for (let i = 0; i < this.centre.length; i++) {
            const c = this.centre[i];

            if (c.frequency === null) {
                continue;
            }

            list.push({
                role: CONTROLLER_TYPE.CTR,
                type: CONTROLLER_TYPE.CTR,
                callsign: c.callsign,
                radioName: c.radioName,
                frequency: c.frequency,
                frequencyKhz: c.frequencyKhz,
                sector: c.sectorId || c.callsign,
                runways: [],
                source: c.source,
                isSimulated: c.isSimulated,
                isUserDefined: c.isUserDefined
            });
        }

        for (let i = 0; i < this.tower.length; i++) {
            const t = this.tower[i];

            if (t.frequency === null) {
                continue;
            }

            list.push({
                role: CONTROLLER_TYPE.TWR,
                type: CONTROLLER_TYPE.TWR,
                callsign: t.callsign,
                radioName: t.radioName,
                frequency: t.frequency,
                frequencyKhz: t.frequencyKhz,
                sector: null,
                runways: [...t.runways],
                source: t.source,
                isSimulated: t.isSimulated,
                isUserDefined: t.isUserDefined
            });
        }

        return list;
    }

    /**
     * Apply user-defined frequency overrides (e.g. from DAT settings UI)
     * and mark updated entries with `source: FREQUENCY_SOURCE.USER`.
     *
     * @param {Object} [overrides={}]
     * @return {ControllerConfigModel}
     */
    applyUserOverrides(overrides = {}) {
        if (!overrides || typeof overrides !== 'object') {
            return this;
        }

        if (overrides.approach) {
            const existing = this.approach || {};
            this.approach = this._buildFrequencyEntry(
                {
                    ...existing,
                    ...overrides.approach,
                    source: FREQUENCY_SOURCE.USER
                },
                FREQUENCY_SOURCE.USER,
                CONTROLLER_TYPE.APP
            );
        }

        if (overrides.departure) {
            const existing = this.departure || {};
            this.departure = this._buildFrequencyEntry(
                {
                    ...existing,
                    ...overrides.departure,
                    source: FREQUENCY_SOURCE.USER
                },
                FREQUENCY_SOURCE.USER,
                CONTROLLER_TYPE.DEP
            );
        }

        if (overrides.tower) {
            const rawTowers = Array.isArray(overrides.tower) ? overrides.tower : [overrides.tower];
            this.tower = rawTowers.map((t, idx) => {
                const existing = this.tower[idx] || {};
                return this._buildTowerEntry(
                    {
                        ...existing,
                        ...t,
                        source: FREQUENCY_SOURCE.USER
                    },
                    FREQUENCY_SOURCE.USER
                );
            });
        }

        if (overrides.centre) {
            const rawCentres = Array.isArray(overrides.centre) ? overrides.centre : [overrides.centre];
            this.centre = rawCentres.map((c, idx) => {
                const existing = this.centre[idx] || {};
                return this._buildCentreEntry(
                    {
                        ...existing,
                        ...c,
                        source: FREQUENCY_SOURCE.USER
                    },
                    FREQUENCY_SOURCE.USER
                );
            });
        }

        return this;
    }

    /**
     * Build a normalized base frequency entry with provenance flags
     *
     * @param {Object} raw
     * @param {string} defaultSource
     * @return {Object}
     * @private
     */
    _buildFrequencyEntry(raw, defaultSource = FREQUENCY_SOURCE.PUBLISHED, type = '') {
        const frequency = normalizeFrequency(raw.frequency);
        const frequencyKhz = frequency !== null ? frequencyToKhz(frequency) : null;
        const source = VALID_FREQUENCY_SOURCES.has(raw.source) ? raw.source : defaultSource;
        const callsign = raw.callsign ? String(raw.callsign) : '';

        return {
            callsign,
            radioName: resolveControllerRadioName({
                icao: this.icao,
                callsign,
                sectorId: raw.sectorId,
                type,
                radioName: raw.radioName,
                fallback: raw.fallbackRadioName
            }),
            frequency,
            frequencyKhz,
            source,
            isSimulated: source === FREQUENCY_SOURCE.SIMULATED,
            isUserDefined: source === FREQUENCY_SOURCE.USER
        };
    }

    /**
     * Build a normalized tower entry
     *
     * @param {Object} raw
     * @param {string} defaultSource
     * @return {Object}
     * @private
     */
    _buildTowerEntry(raw, defaultSource = FREQUENCY_SOURCE.PUBLISHED) {
        const base = this._buildFrequencyEntry(raw, defaultSource, CONTROLLER_TYPE.TWR);
        const runways = Array.isArray(raw.runways) ?
            raw.runways.map((r) => String(r).trim().toUpperCase()).filter(Boolean) :
            [];

        return {
            ...base,
            runways
        };
    }

    /**
     * Build a normalized centre sector entry
     *
     * @param {Object} raw
     * @param {string} defaultSource
     * @return {Object}
     * @private
     */
    _buildCentreEntry(raw, defaultSource = FREQUENCY_SOURCE.PUBLISHED) {
        const base = this._buildFrequencyEntry(raw, defaultSource, CONTROLLER_TYPE.CTR);
        const fallbackCallsign = base.callsign ? base.callsign.toUpperCase() : '';
        const sectorId = raw.sectorId ?
            String(raw.sectorId).trim().toUpperCase() :
            fallbackCallsign;

        return {
            ...base,
            sectorId,
            rules: this._parseCentreRules(raw.rules)
        };
    }

    /**
     * Normalize centre sector matching rules
     *
     * @param {Object} [rawRules={}]
     * @return {Object}
     * @private
     */
    _parseCentreRules(rawRules = {}) {
        const rules = rawRules && typeof rawRules === 'object' ? rawRules : {};
        const waypoints = Array.isArray(rules.waypoints) ?
            rules.waypoints.map((w) => String(w).trim().toUpperCase()).filter(Boolean) :
            [];
        const bearingRanges = Array.isArray(rules.bearingRanges) ?
            rules.bearingRanges.filter((pair) => Array.isArray(pair) && pair.length === 2 &&
                Number.isFinite(pair[0]) && Number.isFinite(pair[1])) :
            [];

        return {
            waypoints,
            bearingRanges,
            minAltitude: rules.minAltitude != null ? Number(rules.minAltitude) : null,
            maxAltitude: rules.maxAltitude != null ? Number(rules.maxAltitude) : null,
            default: rules.default === true
        };
    }

    /**
     * Extract flattened uppercase runway names from airport JSON `runways` array
     *
     * @param {Array} runways
     * @return {Array<string>}
     * @private
     */
    _extractRunwayNames(runways) {
        if (!Array.isArray(runways)) {
            return [];
        }

        const names = [];

        for (let i = 0; i < runways.length; i++) {
            const entry = runways[i];

            if (!entry) {
                continue;
            }

            if (Array.isArray(entry.name)) {
                for (let j = 0; j < entry.name.length; j++) {
                    if (entry.name[j]) {
                        names.push(String(entry.name[j]).trim().toUpperCase());
                    }
                }
            } else if (typeof entry.name === 'string' && entry.name.trim()) {
                names.push(entry.name.trim().toUpperCase());
            } else if (typeof entry === 'string' && entry.trim()) {
                names.push(entry.trim().toUpperCase());
            }
        }

        return names;
    }

    /**
     * Populate simulated Australian fallback defaults when an Australian airport
     * (`Y*` or DAT import) has no explicit `controllers` configuration block.
     *
     * @param {Object} [options={}]
     * @private
     */
    _populateAustralianFallback(options = {}) {
        const radio = options.radio || {};
        const spoken = options.controllerRadioNames || {};
        const runwayNames = this._extractRunwayNames(options.runways);
        const approachCallsign = deriveAustralianControllerCallsign(this.icao, CONTROLLER_TYPE.APP);
        const departureCallsign = deriveAustralianControllerCallsign(this.icao, CONTROLLER_TYPE.DEP);
        const towerCallsign = deriveAustralianControllerCallsign(this.icao, CONTROLLER_TYPE.TWR);

        this.approach = this._buildFrequencyEntry({
            callsign: approachCallsign,
            radioName: spoken.approach,
            fallbackRadioName: radio.app,
            frequency: '124.400',
            source: FREQUENCY_SOURCE.SIMULATED
        }, FREQUENCY_SOURCE.SIMULATED, CONTROLLER_TYPE.APP);

        this.departure = this._buildFrequencyEntry({
            callsign: departureCallsign,
            radioName: spoken.departure,
            fallbackRadioName: radio.dep,
            frequency: '123.000',
            source: FREQUENCY_SOURCE.SIMULATED
        }, FREQUENCY_SOURCE.SIMULATED, CONTROLLER_TYPE.DEP);

        this.tower = [
            this._buildTowerEntry({
                callsign: towerCallsign,
                radioName: spoken.tower,
                fallbackRadioName: radio.twr,
                frequency: '120.500',
                runways: runwayNames,
                source: FREQUENCY_SOURCE.SIMULATED
            }, FREQUENCY_SOURCE.SIMULATED)
        ];

        this.centre = [
            this._buildCentreEntry({
                sectorId: 'YMMM',
                callsign: 'YMMM',
                radioName: spoken.centre,
                frequency: '132.000',
                source: FREQUENCY_SOURCE.SIMULATED,
                rules: {
                    bearingRanges: [[90, 290]],
                    default: true
                }
            }, FREQUENCY_SOURCE.SIMULATED),
            this._buildCentreEntry({
                sectorId: 'YBBB',
                callsign: 'YBBB',
                frequency: '133.150',
                source: FREQUENCY_SOURCE.SIMULATED,
                rules: {
                    bearingRanges: [[290, 90]]
                }
            }, FREQUENCY_SOURCE.SIMULATED)
        ];
    }

    /**
     * Parse the controllers JSON block from airport data
     *
     * @param {Object} json
     * @param {string} defaultSource
     * @private
     */
    _parse(json, defaultSource = FREQUENCY_SOURCE.PUBLISHED) {
        if (json.approach) {
            this.approach = this._buildFrequencyEntry(json.approach, defaultSource, CONTROLLER_TYPE.APP);
        }

        if (json.departure) {
            this.departure = this._buildFrequencyEntry(json.departure, defaultSource, CONTROLLER_TYPE.DEP);
        }

        if (json.tower) {
            const towers = Array.isArray(json.tower) ? json.tower : [json.tower];
            this.tower = towers.map((t) => this._buildTowerEntry(t, defaultSource));
        }

        if (json.centre) {
            const centres = Array.isArray(json.centre) ? json.centre : [json.centre];
            this.centre = centres.map((c) => this._buildCentreEntry(c, defaultSource));
        }

        if (json.handoffThresholds) {
            const ht = json.handoffThresholds;
            const fallbackRec = ht.recommended != null ? ht.recommended : HANDOFF_THRESHOLDS_NM.RECOMMENDED;
            const fallbackUrg = ht.urgent != null ? ht.urgent : HANDOFF_THRESHOLDS_NM.URGENT;
            const fallbackMan = ht.mandatory != null ? ht.mandatory : HANDOFF_THRESHOLDS_NM.MANDATORY;

            this.handoffThresholds = {
                recommendedNm: ht.recommendedNm != null ? ht.recommendedNm : fallbackRec,
                urgentNm: ht.urgentNm != null ? ht.urgentNm : fallbackUrg,
                mandatoryNm: ht.mandatoryNm != null ? ht.mandatoryNm : fallbackMan,
                deadlineSeconds: ht.deadlineSeconds != null ? ht.deadlineSeconds : null
            };
        }

        if (json.departureContactAltitudeAgl != null) {
            if (typeof json.departureContactAltitudeAgl === 'number') {
                this.departureContactAltitudeAgl = {
                    minAgl: DEPARTURE_CONTACT_MIN_AGL,
                    targetAgl: json.departureContactAltitudeAgl,
                    transferDistanceNm: null
                };
            } else if (typeof json.departureContactAltitudeAgl === 'object') {
                const dca = json.departureContactAltitudeAgl;
                this.departureContactAltitudeAgl = {
                    minAgl: dca.minAgl != null ? dca.minAgl : DEPARTURE_CONTACT_MIN_AGL,
                    targetAgl: dca.targetAgl != null ? dca.targetAgl : DEPARTURE_CONTACT_ALTITUDE_AGL,
                    transferDistanceNm: dca.transferDistanceNm != null ? dca.transferDistanceNm : null
                };
            }
        }

        if (json.vfrClearanceBoundaries && typeof json.vfrClearanceBoundaries === 'object') {
            this.vfrClearanceBoundaries = {
                ...this.vfrClearanceBoundaries,
                ...json.vfrClearanceBoundaries
            };
        }

        if (json.fcaRules && typeof json.fcaRules === 'object') {
            this.fcaRules = {
                ...this.fcaRules,
                ...json.fcaRules
            };
        }
    }
}
