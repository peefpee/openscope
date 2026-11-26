import test from 'ava';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import DynamicPositionModel from '../../src/assets/scripts/client/base/DynamicPositionModel';
import ControllerConfigModel from '../../src/assets/scripts/client/controller/ControllerConfigModel';
import { parseAirportDat } from '../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../src/assets/scripts/client/airport/dat/buildDatScope';
import { CONTROLLER_TYPE, FREQUENCY_SOURCE } from '../../src/assets/scripts/client/constants/controllerConstants';
import { FLIGHT_RULES } from '../../src/assets/scripts/client/constants/aircraftConstants';
import yssyData from '../../assets/airports/yssy.json';

test('parses YSSY controllers config with published APP/DEP/TWR and simulated YMMM/YBBB Centre sectors', (t) => {
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;
    const config = airport.controllerConfig;

    t.true(config instanceof ControllerConfigModel);
    t.true(config.hasControllerConfig);

    t.deepEqual(config.getApproach().callsign, 'SY_APP');
    t.is(config.getApproach().frequency, '124.400');
    t.is(config.getApproach().frequencyKhz, 124400);
    t.is(config.getApproach().source, FREQUENCY_SOURCE.PUBLISHED);
    t.false(config.getApproach().isSimulated);

    t.is(config.getDeparture().callsign, 'SY_DEP');
    t.is(config.getDeparture().frequency, '123.000');
    t.false(config.getDeparture().combinedWithApproach);

    t.is(config.getTowerForRunway('16R').frequency, '120.500');
    t.is(config.getTowerForRunway('34L').callsign, 'SY_TWR');
    t.is(config.getTowerForRunway('07').frequency, '120.500');
    t.is(config.getTowerForRunway('16L').frequency, '124.700');
    t.is(config.getTowerForRunway('34R').callsign, 'SY_TWR_E');
    t.is(config.getTowerForRunway(null).frequency, '120.500');

    const sectors = config.getAllCentreSectors();
    t.is(sectors.length, 1);
    t.is(sectors[0].sectorId, 'YMMM');
    t.is(sectors[0].frequency, '132.000');
    t.true(sectors[0].isSimulated);

    const adj = config.getAdjacentFrequencyList();
    t.is(adj.length, 2);
    t.true(adj.some((item) => item.role === CONTROLLER_TYPE.CTR && item.sector === 'YMMM' && item.isSimulated));
    t.true(adj.some((item) => item.role === CONTROLLER_TYPE.TWR && item.frequency === '120.500' && !item.isSimulated));

    airport.releaseWindListener();
});

test('synthesizes simulated Australian fallback defaults for Y* airports without controllers block', (t) => {
    const config = new ControllerConfigModel(null, {
        icao: 'YMHB',
        radio: { twr: 'Hobart Tower', app: 'Hobart Approach', dep: 'Hobart Departures' },
        runways: [{ name: ['12', '30'] }]
    });

    t.true(config.hasControllerConfig);
    t.is(config.getApproach().callsign, 'HB_APP');
    t.is(config.getApproach().radioName, 'Hobart Approach');
    t.is(config.getApproach().source, FREQUENCY_SOURCE.PUBLISHED);
    t.false(config.getApproach().isSimulated);
    t.is(config.getTowerForRunway('12').callsign, 'HB_TWR');
    t.is(config.getTowerForRunway('12').radioName, 'Hobart Tower');
    t.deepEqual(config.getTowerForRunway('12').runways, ['12', '30']);
    t.is(config.getAllCentreSectors().length, 1);
    t.is(config.getHandoffThresholds().recommendedNm, 12);
    t.is(config.getDepartureContactAltitudeAgl().minAgl, 500);
    t.is(config.getDepartureContactAltitudeAgl().targetAgl, 1500);
});

test('does not synthesize Australian config for international airports without controllers block', (t) => {
    const config = new ControllerConfigModel(null, { icao: 'KLAS' });
    t.false(config.hasControllerConfig);
    t.is(config.getApproach(), null);
    t.is(config.getDeparture(), null);
    t.deepEqual(config.getAllTowers(), []);
    t.deepEqual(config.getAllCentreSectors(), []);
});

test('combines departure with approach when departure is omitted and supports applyUserOverrides', (t) => {
    const config = new ControllerConfigModel({
        approach: { callsign: 'YPPH_APP', frequency: '123.6' },
        tower: { callsign: 'YPPH_TWR', frequency: '120.5', runways: ['03', '21'] }
    }, { icao: 'YPPH' });

    const dep = config.getDeparture();
    t.is(dep.callsign, 'YPPH_APP');
    t.is(dep.frequency, '123.600');
    t.true(dep.combinedWithApproach);

    config.applyUserOverrides({
        tower: [{ callsign: 'YPPH_TWR', frequency: '118.1', runways: ['03', '21'] }]
    });

    const updatedTwr = config.getTowerForRunway('03');
    t.is(updatedTwr.frequency, '118.100');
    t.is(updatedTwr.source, FREQUENCY_SOURCE.USER);
    t.true(updatedTwr.isUserDefined);
    t.false(updatedTwr.isSimulated);
});

test('selectCentreSector chooses YMMM vs YBBB deterministically when multi-sector rules are configured', (t) => {
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;
    const config = new ControllerConfigModel({
        centre: [
            {
                sectorId: 'YMMM',
                callsign: 'YMMM',
                frequency: '132.000',
                source: 'simulated',
                rules: { waypoints: ['KEVIN'], bearingRanges: [[90, 290]], default: true }
            },
            {
                sectorId: 'YBBB',
                callsign: 'YBBB',
                frequency: '133.150',
                source: 'simulated',
                rules: { waypoints: ['BOREE'], bearingRanges: [[290, 90]] }
            }
        ]
    }, { icao: 'YSSY' });

    const northWaypointAc = {
        altitude: 15000,
        fms: { outboundWaypoint: { name: 'BOREE' }, currentWaypoint: null },
        positionModel: airport.positionModel.generateDynamicPositionFromBearingAndDistance(0, 10)
    };
    t.is(config.selectCentreSector(northWaypointAc, airport).sectorId, 'YBBB');

    const southWaypointAc = {
        altitude: 15000,
        fms: { outboundWaypoint: { name: 'KEVIN' }, currentWaypoint: null },
        positionModel: airport.positionModel.generateDynamicPositionFromBearingAndDistance(Math.PI, 10)
    };
    t.is(config.selectCentreSector(southWaypointAc, airport).sectorId, 'YMMM');

    // Bearing-only fallback without matching waypoint (045 deg -> YBBB; 180 deg -> YMMM)
    const neBearingAc = {
        altitude: 15000,
        fms: {},
        positionModel: airport.positionModel.generateDynamicPositionFromBearingAndDistance(Math.PI / 4, 25)
    };
    t.is(config.selectCentreSector(neBearingAc, airport).sectorId, 'YBBB');

    const southBearingAc = {
        altitude: 15000,
        fms: {},
        positionModel: airport.positionModel.generateDynamicPositionFromBearingAndDistance(Math.PI, 25)
    };
    t.is(config.selectCentreSector(southBearingAc, airport).sectorId, 'YMMM');

    airport.releaseWindListener();
});

test('evaluateFcaEligibility rejects ground, IFR, VFR arrivals, and inside/ahead controlled airspace while allowing clear VFR exit', (t) => {
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;
    const config = airport.controllerConfig;

    const groundVfr = {
        rules: FLIGHT_RULES.VFR,
        altitude: 21,
        isAirborne: () => false,
        isArrival: () => false
    };
    t.false(config.isFcaEligible(groundVfr, airport));

    const airborneIfr = {
        rules: FLIGHT_RULES.IFR,
        altitude: 10000,
        isAirborne: () => true,
        isArrival: () => false
    };
    t.false(config.isFcaEligible(airborneIfr, airport));

    // VFR arrival even outside controlled airspace must be rejected from fca
    const vfrArrivalOutside = {
        rules: FLIGHT_RULES.VFR,
        altitude: 3000,
        groundTrack: 0,
        heading: 0,
        positionModel: new DynamicPositionModel(
            airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 70),
            airport.positionModel,
            airport.magneticNorth
        ),
        isAirborne: () => true,
        isArrival: () => true
    };
    const vfrArrResult = config.evaluateFcaEligibility(vfrArrivalOutside, airport);
    t.false(vfrArrResult.eligible);
    t.regex(vfrArrResult.reason, /Tower handoff/);

    // Inside YSSY Class C (15 NM north, 3000 ft) even when 10/20 NM ahead are outside Class C -> rejected
    const vfrInsideClassC = {
        rules: FLIGHT_RULES.VFR,
        altitude: 3000,
        groundTrack: 0,
        heading: 0,
        positionModel: new DynamicPositionModel(
            airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 15),
            airport.positionModel,
            airport.magneticNorth
        ),
        isAirborne: () => true,
        isArrival: () => false
    };
    t.true(airport.isPointWithinAirspace(vfrInsideClassC.positionModel.relativePosition, 3000));
    const insideResult = config.evaluateFcaEligibility(vfrInsideClassC, airport);
    t.false(insideResult.eligible);
    t.regex(insideResult.reason, /inside controlled airspace/);

    // Outside YSSY airspace heading toward airport center -> controlled airspace ahead
    const vfrHeadingIn = {
        rules: FLIGHT_RULES.VFR,
        altitude: 3000,
        groundTrack: Math.PI,
        heading: Math.PI,
        positionModel: new DynamicPositionModel(
            airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 30),
            airport.positionModel,
            airport.magneticNorth
        ),
        isAirborne: () => true,
        isArrival: () => false
    };
    t.false(airport.isPointWithinAirspace(vfrHeadingIn.positionModel.relativePosition, 3000));
    const aheadResult = config.evaluateFcaEligibility(vfrHeadingIn, airport);
    t.false(aheadResult.eligible);
    t.regex(aheadResult.reason, /controlled airspace ahead/);

    // 70 NM north outbound heading 000 -> well outside YSSY airspace and no airspace ahead
    const vfrClearOutbound = {
        rules: FLIGHT_RULES.VFR,
        altitude: 3000,
        groundTrack: 0,
        heading: 0,
        positionModel: new DynamicPositionModel(
            airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 70),
            airport.positionModel,
            airport.magneticNorth
        ),
        isAirborne: () => true,
        isArrival: () => false
    };
    t.false(airport.isPointWithinAirspace(vfrClearOutbound.positionModel.relativePosition, 3000));
    t.true(config.isFcaEligible(vfrClearOutbound, airport));

    airport.releaseWindListener();
});

test('evaluateFcaEligibility rejects VFR arrivals and VFR departures inside YTES DAT CTR while allowing clear exit outside CTR', (t) => {
    const datData = parseAirportDat([
        'RWY:RW09, , ,00050, , , , ;S34000000,E140000000,0000;',
        'RWY:RW27, , ,00050, , , , ;S34000000,E140010000,0000;'
    ].join('\n'), 'YTES.dat');
    const scope = buildDatScope(datData, resolveWaypoints(datData));
    const ytes = new AirportModel(scope);
    ytes.data = scope;
    const config = ytes.controllerConfig;

    // 5 NM north, 1500 ft is inside YTES 10 NM CTR even though 10/20 NM forward points are outside CTR
    const vfrDepInsideCtr = {
        rules: FLIGHT_RULES.VFR,
        altitude: 1500,
        groundTrack: 0,
        heading: 0,
        positionModel: new DynamicPositionModel(
            ytes.positionModel.generateCoordinatesFromBearingAndDistance(0, 5),
            ytes.positionModel,
            ytes.magneticNorth
        ),
        isAirborne: () => true,
        isArrival: () => false
    };
    t.true(ytes.isPointWithinAirspace(vfrDepInsideCtr.positionModel.relativePosition, 1500));
    t.false(config.isFcaEligible(vfrDepInsideCtr, ytes));

    const vfrArrOutsideCtr = {
        rules: FLIGHT_RULES.VFR,
        altitude: 1500,
        groundTrack: 0,
        heading: 0,
        positionModel: new DynamicPositionModel(
            ytes.positionModel.generateCoordinatesFromBearingAndDistance(0, 15),
            ytes.positionModel,
            ytes.magneticNorth
        ),
        isAirborne: () => true,
        isArrival: () => true
    };
    t.false(config.isFcaEligible(vfrArrOutsideCtr, ytes));

    // 15 NM north, 1500 ft heading 000 is outside YTES CTR and below CTA shelf with clear path ahead
    const vfrDepClear = {
        rules: FLIGHT_RULES.VFR,
        altitude: 1500,
        groundTrack: 0,
        heading: 0,
        positionModel: new DynamicPositionModel(
            ytes.positionModel.generateCoordinatesFromBearingAndDistance(0, 15),
            ytes.positionModel,
            ytes.magneticNorth
        ),
        isAirborne: () => true,
        isArrival: () => false
    };
    t.false(ytes.isPointWithinAirspace(vfrDepClear.positionModel.relativePosition, 1500));
    t.true(config.isFcaEligible(vfrDepClear, ytes));

    ytes.releaseWindListener();
});
