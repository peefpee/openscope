import test from 'ava';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import AircraftCommander from '../../src/assets/scripts/client/aircraft/AircraftCommander';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import ControllerConfigModel from '../../src/assets/scripts/client/controller/ControllerConfigModel';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import NavDataCache from '../../src/assets/scripts/client/airport/dat/NavDataCache';
import { parseAirportDat } from '../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../src/assets/scripts/client/airport/dat/buildDatScope';
import { CONTROLLER_TYPE, FREQUENCY_SOURCE } from '../../src/assets/scripts/client/constants/controllerConstants';
import { FLIGHT_PHASE } from '../../src/assets/scripts/client/constants/aircraftConstants';
import a320 from '../../assets/aircraft/a320.json';
import yssyData from '../../assets/airports/yssy.json';

function buildMinimalAuAirport(icao, runways = [{ name: ['16', '34'] }]) {
    const config = new ControllerConfigModel(null, { icao, runways });
    return config;
}

test('switching between YMML, YBBN, YSSY, and YPAD loads airport-specific single-sector frequencies and spoken names', (t) => {
    const ymml = buildMinimalAuAirport('YMML', [{ name: ['16', '34'] }, { name: ['09', '27'] }]);
    const ybbn = buildMinimalAuAirport('YBBN', [{ name: ['01L', '19R'] }]);
    const ypad = buildMinimalAuAirport('YPAD', [{ name: ['05', '23'] }]);
    const yssyAirport = new AirportModel(yssyData);
    yssyAirport.data = yssyData;
    const yssy = yssyAirport.controllerConfig;

    // Only one Centre controller per airport in single-sector mode
    t.is(ymml.getAllCentreSectors().length, 1);
    t.is(ybbn.getAllCentreSectors().length, 1);
    t.is(ypad.getAllCentreSectors().length, 1);
    t.is(yssy.getAllCentreSectors().length, 1);

    // Distinct FIRs and distinct airport-specific Centre frequencies
    t.is(ymml.getPrimaryCentre().sectorId, 'YMMM');
    t.is(ymml.getPrimaryCentre().frequency, '123.800');
    t.is(ymml.getPrimaryCentre().radioName, 'Melbourne Centre');

    t.is(ypad.getPrimaryCentre().sectorId, 'YMMM');
    t.is(ypad.getPrimaryCentre().frequency, '133.950');

    t.is(ybbn.getPrimaryCentre().sectorId, 'YBBB');
    t.is(ybbn.getPrimaryCentre().frequency, '133.150');
    t.is(ybbn.getPrimaryCentre().radioName, 'Brisbane Centre');

    t.is(yssy.getPrimaryCentre().sectorId, 'YMMM');
    t.is(yssy.getPrimaryCentre().frequency, '132.000');

    // Airport-specific Approach and Tower callsigns/frequencies/spoken names
    t.is(ymml.getApproach().callsign, 'ML_APP');
    t.is(ymml.getApproach().frequency, '132.000');
    t.is(ymml.getApproach().radioName, 'Melbourne Approach');
    t.is(ymml.primaryTowerCallsign, 'ML_TWR');
    t.is(ymml.primaryTowerRadioName, 'Melbourne Tower');

    t.is(ybbn.getApproach().callsign, 'BN_APP');
    t.is(ybbn.getApproach().frequency, '124.700');
    t.is(ybbn.getApproach().radioName, 'Brisbane Approach');
    t.is(ybbn.primaryTowerCallsign, 'BN_TWR');
    t.is(ybbn.primaryTowerRadioName, 'Brisbane Tower');

    t.is(ypad.getApproach().callsign, 'AD_APP');
    t.is(ypad.getApproach().frequency, '118.200');
    t.is(ypad.getApproach().radioName, 'Adelaide Approach');
    t.is(ypad.primaryTowerCallsign, 'AD_TWR');
    t.is(ypad.primaryTowerRadioName, 'Adelaide Tower');

    // Unknown Australian airport does not reuse Sydney Tower 120.500
    const yzzz = buildMinimalAuAirport('YZZZ', [{ name: ['12', '30'] }]);
    t.not(yzzz.primaryTowerFrequency, '120.500');
    t.true(yzzz.tower[0].isSimulated);
    t.is(yzzz.getAllCentreSectors().length, 1);

    yssyAirport.releaseWindListener();
});

test('changing active runway configuration filters multi-tower frequency list', (t) => {
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;

    // Default YSSY active runways: 34L (arr) / 16R (dep) -> both on SY_TWR (120.500)
    let adj = airport.controllerConfig.getAdjacentFrequencyList();
    let twrs = adj.filter((item) => item.type === CONTROLLER_TYPE.TWR);
    t.is(twrs.length, 1);
    t.is(twrs[0].callsign, 'SY_TWR');
    t.is(twrs[0].frequency, '120.500');

    // Split runway configuration: 34L (arr) and 34R (dep) -> both SY_TWR and SY_TWR_E required
    airport.setActiveRunwaysFromNames('34L', '34R');
    adj = airport.controllerConfig.getAdjacentFrequencyList();
    twrs = adj.filter((item) => item.type === CONTROLLER_TYPE.TWR);
    t.is(twrs.length, 2);
    t.true(twrs.some((item) => item.callsign === 'SY_TWR' && item.frequency === '120.500'));
    t.true(twrs.some((item) => item.callsign === 'SY_TWR_E' && item.frequency === '124.700'));

    // East-only configuration: 16L (arr) and 34R (dep) -> only SY_TWR_E (124.700)
    airport.setActiveRunwaysFromNames('16L', '34R');
    adj = airport.controllerConfig.getAdjacentFrequencyList();
    twrs = adj.filter((item) => item.type === CONTROLLER_TYPE.TWR);
    t.is(twrs.length, 1);
    t.is(twrs[0].callsign, 'SY_TWR_E');
    t.is(twrs[0].frequency, '124.700');

    airport.releaseWindListener();
});

test.serial('switching airports rejects frequencies belonging to the previous airport', (t) => {
    NavigationLibrary.reset();
    NavigationLibrary.init(yssyData);
    const yssy = new AirportModel(yssyData);
    yssy.data = yssyData;
    AirportController.current = yssy;

    const commander = new AircraftCommander();
    const dep = new AircraftModel({
        airline: 'qfa',
        callsign: '401',
        airlineCallsign: 'qantas',
        category: 'departure',
        origin: 'YSSY',
        destination: '',
        altitude: 5000,
        speed: 250,
        heading: 0,
        model: new AircraftTypeDefinitionModel(a320),
        positionModel: yssy.positionModel.generateDynamicPositionFromBearingAndDistance(0, 15),
        routeString: yssyData.spawnPatterns.find((p) => p.category === 'departure').route
    });
    dep.setFlightPhase(FLIGHT_PHASE.CLIMB);
    dep.altitude = 5000;
    dep.speed = 250;
    dep.setControllerState({ currentController: CONTROLLER_TYPE.APP });
    dep.isTrackingOutbound = () => true;

    // On YSSY, YBBB 133.150 is rejected and YMMM 132.000 is accepted
    t.false(commander.run(dep, 'contact', ['ctr', '133.15'])[0]);
    t.true(commander.run(dep, 'contact', ['ctr', '132.0'])[0]);

    // Switch to custom DAT-imported YBBN-like scope with YBBB 133.150 and Tower 120.500
    yssy.releaseWindListener();
    const dat = parseAirportDat(
        'RWY:RW01, , ,00013, , , , ;S27230000,E153070000,0000;\n' +
        'RWY:RW19, , ,00013, , , , ;S27210000,E153070000,0000;',
        'YBBN.dat'
    );
    const scope = buildDatScope(dat, resolveWaypoints(dat));
    NavigationLibrary.reset();
    NavigationLibrary.init(scope);
    const ybbn = new AirportModel(scope);
    ybbn.data = scope;
    AirportController.current = ybbn;

    const dep2 = new AircraftModel({
        airline: 'qfa',
        callsign: '402',
        airlineCallsign: 'qantas',
        category: 'departure',
        origin: 'YBBN',
        destination: '',
        altitude: 5000,
        speed: 250,
        heading: 0,
        model: new AircraftTypeDefinitionModel(a320),
        positionModel: ybbn.positionModel.generateDynamicPositionFromBearingAndDistance(0, 15),
        routeString: scope.spawnPatterns.find((p) => p.category === 'departure').route
    });
    dep2.setFlightPhase(FLIGHT_PHASE.CLIMB);
    dep2.altitude = 5000;
    dep2.speed = 250;
    dep2.setControllerState({ currentController: CONTROLLER_TYPE.APP });
    dep2.isTrackingOutbound = () => true;

    // Previous airport's YMMM 132.000 is now rejected on YBBN; YBBB 133.150 is accepted
    t.false(commander.run(dep2, 'contact', ['ctr', '132.0'])[0]);
    const [ok, readback] = commander.run(dep2, 'contact', ['ctr', '133.15']);
    t.true(ok);
    t.is(readback.log, 'contact YBBB on 133.150');
    t.is(readback.say, 'contact Brisbane Centre on one three three decimal one five zero');

    ybbn.releaseWindListener();
    NavigationLibrary.reset();
    AirportController.reset();
});

test('custom imported airport persists independent controller settings and overrides', (t) => {
    const dat = parseAirportDat(
        'RWY:RW14, , ,00020, , , , ;S28090000,E153300000,0000;\n' +
        'RWY:RW32, , ,00020, , , , ;S28100000,E153310000,0000;',
        'YBCG.dat'
    );
    const scope = buildDatScope(dat, resolveWaypoints(dat));
    scope.controllers = {
        approach: { callsign: 'CG_APP', radioName: 'Gold Coast Approach', frequency: '119.500', source: FREQUENCY_SOURCE.USER },
        tower: [{ callsign: 'CG_TWR', radioName: 'Gold Coast Tower', frequency: '118.700', runways: ['14', '32'], source: FREQUENCY_SOURCE.USER }],
        centre: [{ sectorId: 'YBBB', callsign: 'YBBB', radioName: 'Brisbane Centre', frequency: '125.700', source: FREQUENCY_SOURCE.USER, rules: { default: true } }]
    };

    const airport = new AirportModel(scope);
    airport.data = scope;
    const config = airport.controllerConfig;

    t.is(config.getApproach().callsign, 'CG_APP');
    t.is(config.getApproach().frequency, '119.500');
    t.is(config.getApproach().radioName, 'Gold Coast Approach');
    t.true(config.getApproach().isUserDefined);
    t.is(config.primaryTowerCallsign, 'CG_TWR');
    t.is(config.primaryTowerFrequency, '118.700');
    t.is(config.getPrimaryCentre().sectorId, 'YBBB');
    t.is(config.getPrimaryCentre().frequency, '125.700');

    // Verify NavDataCache stores per-airport settings independently
    NavDataCache.records.set('airport/YBCG', {
        key: 'airport/YBCG',
        controllerSettings: { approachFrequency: '119.500', towerFrequency: '118.700', centreSector: 'YBBB', centreFrequency: '125.700' }
    });
    t.is(NavDataCache.records.get('airport/YBCG').controllerSettings.centreSector, 'YBBB');

    airport.releaseWindListener();
});
