import test from 'ava';
import sinon from 'sinon';
import AircraftCommander from '../../src/assets/scripts/client/aircraft/AircraftCommander';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import { parseAirportDat } from '../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../src/assets/scripts/client/airport/dat/buildDatScope';
import DynamicPositionModel from '../../src/assets/scripts/client/base/DynamicPositionModel';
import { AIRCRAFT_EVENT } from '../../src/assets/scripts/client/constants/eventNames';
import { CONTROLLER_TYPE, HANDOFF_STATE } from '../../src/assets/scripts/client/constants/controllerConstants';
import { FLIGHT_PHASE, FLIGHT_RULES } from '../../src/assets/scripts/client/constants/aircraftConstants';
import EventBus from '../../src/assets/scripts/client/lib/EventBus';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import TimeKeeper from '../../src/assets/scripts/client/engine/TimeKeeper';
import RegexGroup from '../../src/assets/scripts/client/ui/autocomplete/RegexGroup';
import commandAutocompleteConfig from '../../assets/autocomplete/commandAutocompleteConfig.json';
import a320 from '../../assets/aircraft/a320.json';
import c172 from '../../assets/aircraft/c172.json';
import yssyData from '../../assets/airports/yssy.json';

function setupYssy() {
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;
    AirportController.current = airport;
    NavigationLibrary.init(yssyData);
    return airport;
}

test.serial('contact twr validates runway assignment, approach eligibility, and frequency formats', (t) => {
    const airport = setupYssy();
    const commander = new AircraftCommander();
    const handoffEvents = [];
    const onTowerHandoff = (payload) => handoffEvents.push(payload);
    EventBus.on(AIRCRAFT_EVENT.TOWER_HANDOFF, onTowerHandoff);

    try {
        const runway16R = airport.getRunway('16R');
        const runway16L = airport.getRunway('16L');
        const arrivalRoute = yssyData.spawnPatterns.find((p) => p.category === 'arrival').route;
        const arrival = new AircraftModel({
            airline: 'qfa',
            callsign: '412',
            airlineCallsign: 'qantas',
            category: 'arrival',
            origin: '',
            destination: 'YSSY',
            altitude: 4000,
            speed: 180,
            heading: runway16R.angle,
            model: new AircraftTypeDefinitionModel(a320),
            positionModel: runway16R.positionModel.generateDynamicPositionFromBearingAndDistance(Math.PI, 8),
            routeString: arrivalRoute,
            controllerState: {
                currentController: CONTROLLER_TYPE.APP,
                currentFrequency: '124.400',
                handoffState: HANDOFF_STATE.REQUIRED
            }
        });
        arrival.fms.setArrivalRunway(runway16R);

        // Rejects invalid frequency
        t.false(commander.run(arrival, 'contact', ['twr', '117.5'])[0]);
        // Rejects wrong Tower frequency not configured at YSSY
        t.false(commander.run(arrival, 'contact', ['twr', '118.1'])[0]);
        // Rejects wrong Tower for Runway 16R (124.7 is SY_TWR_E for 16L/34R)
        const wrongRwy = commander.run(arrival, 'contact', ['twr', '124.7']);
        t.false(wrongRwy[0]);
        t.regex(wrongRwy[1], /16R/);
        // Rejects when not cleared for approach
        const noApproach = commander.run(arrival, 'contact', ['twr', '120.5']);
        t.false(noApproach[0]);
        t.regex(noApproach[1], /not cleared for approach/);

        // Eligible once cleared and established
        arrival.pilot.hasApproachClearance = true;
        const establishedStub = sinon.stub(arrival, 'isEstablishedOnCourse').returns(true);
        const ok = commander.run(arrival, 'contact', ['twr', '120.5']);
        establishedStub.restore();

        t.true(ok[0]);
        t.is(ok[1].log, 'contact SY_TWR on 120.500');
        t.falsy(arrival.landingClearance);
        const transmission = sinon.stub(arrival, 'radioCall');
        airport.towerController.updateArrivalHandoff(arrival);
        t.is(arrival.landingClearance.runway, '16R');
        t.is(arrival.landingClearance.issuer, CONTROLLER_TYPE.TWR);
        airport.towerController.updateArrivalHandoff(arrival);
        t.is(transmission.callCount, 1);
        transmission.restore();
        t.is(arrival.controllerState.currentController, CONTROLLER_TYPE.TWR);
        t.is(arrival.controllerState.currentFrequency, '120.500');
        t.is(arrival.controllerState.handoffState, HANDOFF_STATE.COMPLETED);
        t.false(arrival.isPlayerControlled());
        t.false(arrival.isControllable);
        // Landed arrivals remain physically simulated (never marked removable on Tower handoff)
        t.false(arrival.isRemovable);
        t.is(handoffEvents.length, 1);
        t.is(handoffEvents[0].frequency, '120.500');

        // Parallel east runway 16L accepts 124.70
        const eastArrival = new AircraftModel({
            airline: 'voe',
            callsign: '500',
            airlineCallsign: 'velocity',
            category: 'arrival',
            origin: '',
            destination: 'YSSY',
            altitude: 4000,
            speed: 180,
            heading: runway16L.angle,
            model: new AircraftTypeDefinitionModel(a320),
            positionModel: runway16L.positionModel.generateDynamicPositionFromBearingAndDistance(Math.PI, 8),
            routeString: arrivalRoute,
            controllerState: {
                currentController: CONTROLLER_TYPE.APP,
                currentFrequency: '124.400',
                handoffState: HANDOFF_STATE.REQUIRED
            }
        });
        eastArrival.fms.setArrivalRunway(runway16L);
        eastArrival.pilot.hasApproachClearance = true;
        sinon.stub(eastArrival, 'isEstablishedOnCourse').returns(true);
        const eastOk = commander.run(eastArrival, 'contact', ['twr', '124.70']);
        t.true(eastOk[0]);
        t.is(eastOk[1].log, 'contact SY_TWR_E on 124.700');
    } finally {
        EventBus.off(AIRCRAFT_EVENT.TOWER_HANDOFF, onTowerHandoff);
        airport.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});

test.serial('contact ctr and unified runCentre validate sector, eligibility, and keep aircraft simulated inside airspace', (t) => {
    const airport = setupYssy();
    const commander = new AircraftCommander();
    const centreEvents = [];
    const onCentreHandoff = (payload) => centreEvents.push(payload);
    EventBus.on(AIRCRAFT_EVENT.CENTRE_HANDOFF, onCentreHandoff);

    try {
        const runway = airport.departureRunwayModel;
        const depNorth = new AircraftModel({
            airline: 'qfa',
            callsign: '414',
            airlineCallsign: 'qantas',
            category: 'departure',
            origin: 'YSSY',
            destination: '',
            altitude: 5000,
            speed: 250,
            heading: 0,
            model: new AircraftTypeDefinitionModel(a320),
            positionModel: runway.positionModel.generateDynamicPositionFromBearingAndDistance(0, 15),
            routeString: 'YSSY16R.OLSEM1.OLSEM'
        });
        depNorth.setFlightPhase(FLIGHT_PHASE.CLIMB);
        depNorth.altitude = 5000;
        depNorth.speed = 250;

        // Not tracking outbound yet -> both contact ctr and centre must reject
        t.false(commander.run(depNorth, 'contact', ['ctr', '132.0'])[0]);
        t.false(commander.run(depNorth, 'centre', [])[0]);

        sinon.stub(depNorth, 'isTrackingOutbound').returns(true);
        depNorth.fms.setDepartureOutbound('OLSEM');

        // Wrong Centre frequency (133.150 instead of YMMM 132.000)
        const wrongSector = commander.run(depNorth, 'contact', ['ctr', '133.15']);
        t.false(wrongSector[0]);
        t.regex(wrongSector[1], /133\.150 is not a valid Centre frequency/);

        // Correct single-sector Centre frequency (132.0 -> 132.000)
        const ok = commander.run(depNorth, 'contact', ['ctr', '132.0']);
        t.true(ok[0]);
        t.is(ok[1].log, 'contact YMMM on 132.000');
        t.is(ok[1].say, 'contact Melbourne Centre on one three two decimal zero zero zero');
        t.true(depNorth.transferredToCentre);
        t.false(depNorth.isPlayerControlled());
        t.false(depNorth.isControllable);
        // Inside YSSY controlled airspace -> still physically simulated (isRemovable = false)
        t.true(depNorth.isInsideAirspace(airport));
        t.false(depNorth.isRemovable);
        t.is(centreEvents.length, 1);

        // Unified `centre` command on a second departure routes through same validation
        const depSouth = new AircraftModel({
            airline: 'jst',
            callsign: '700',
            airlineCallsign: 'jetstar',
            category: 'departure',
            origin: 'YSSY',
            destination: '',
            altitude: 6000,
            speed: 250,
            heading: Math.PI,
            model: new AircraftTypeDefinitionModel(a320),
            positionModel: runway.positionModel.generateDynamicPositionFromBearingAndDistance(Math.PI, 15),
            routeString: 'YSSY16R.KEVIN7.KEVIN'
        });
        depSouth.setFlightPhase(FLIGHT_PHASE.CLIMB);
        depSouth.altitude = 6000;
        depSouth.speed = 250;
        sinon.stub(depSouth, 'isTrackingOutbound').returns(true);
        depSouth.fms.setDepartureOutbound('KEVIN');
        const centreOk = commander.run(depSouth, 'centre', []);
        t.true(centreOk[0]);
        t.is(depSouth.controllerState.currentController, CONTROLLER_TYPE.CTR);
        t.is(depSouth.controllerState.currentFrequency, '132.000');
        t.false(depSouth.isRemovable);
    } finally {
        EventBus.off(AIRCRAFT_EVENT.CENTRE_HANDOFF, onCentreHandoff);
        airport.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});

test.serial('freqChangeApproved rejects IFR and airspace-ahead flights, and releases eligible VFR departure', (t) => {
    const airport = setupYssy();
    const commander = new AircraftCommander();
    const fcaEvents = [];
    const onFca = (payload) => fcaEvents.push(payload);
    EventBus.on(AIRCRAFT_EVENT.FREQ_CHANGE_APPROVED, onFca);

    try {
        const runway = airport.departureRunwayModel;
        const ifrDep = new AircraftModel({
            airline: 'qfa',
            callsign: '800',
            airlineCallsign: 'qantas',
            category: 'departure',
            origin: 'YSSY',
            destination: '',
            altitude: 5000,
            speed: 250,
            heading: 0,
            model: new AircraftTypeDefinitionModel(a320),
            positionModel: runway.positionModel.generateDynamicPositionFromBearingAndDistance(0, 70),
            routeString: 'YSSY25.AVMOV1.AVMOV'
        });
        ifrDep.setFlightPhase(FLIGHT_PHASE.CLIMB);
        ifrDep.altitude = 5000;
        ifrDep.speed = 250;
        const ifrReject = commander.run(ifrDep, 'freqChangeApproved', []);
        t.false(ifrReject[0]);
        t.regex(ifrReject[1], /IFR/);

        const vfrClear = new AircraftModel({
            airline: 'vh',
            callsign: 'abc',
            airlineCallsign: '',
            rules: FLIGHT_RULES.VFR,
            category: 'departure',
            origin: 'YSSY',
            destination: '',
            altitude: 3000,
            speed: 110,
            heading: 0,
            model: new AircraftTypeDefinitionModel(c172),
            positionModel: new DynamicPositionModel(
                airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 70),
                airport.positionModel,
                airport.magneticNorth
            ),
            routeString: 'YSSY25.AVMOV1.AVMOV'
        });
        vfrClear.setFlightPhase(FLIGHT_PHASE.CLIMB);
        vfrClear.altitude = 3000;
        vfrClear.speed = 110;
        t.false(vfrClear.isInsideAirspace(airport));

        const ok = commander.run(vfrClear, 'freqChangeApproved', []);
        t.true(ok[0], JSON.stringify(ok));
        t.is(ok[1].log, 'frequency change approved, good day');
        t.is(vfrClear.controllerState.handoffState, HANDOFF_STATE.RELEASED);
        t.true(vfrClear.controllerState.communicationReleased);
        t.is(vfrClear.controllerState.currentController, CONTROLLER_TYPE.NONE);
        t.false(vfrClear.isPlayerControlled());
        t.false(vfrClear.isControllable);
        // 70 NM away is outside YSSY airspace, so isRemovable becomes true
        t.true(vfrClear.isRemovable);
        t.is(fcaEvents.length, 1);

        // VFR arrival at YSSY (even outside airspace) is rejected by fca
        const arrivalRoute = yssyData.spawnPatterns.find((p) => p.category === 'arrival').route;
        const vfrArrivalYssy = new AircraftModel({
            airline: 'vh',
            callsign: 'var',
            airlineCallsign: '',
            rules: FLIGHT_RULES.VFR,
            category: 'arrival',
            origin: '',
            destination: 'YSSY',
            altitude: 3000,
            speed: 110,
            heading: 0,
            model: new AircraftTypeDefinitionModel(c172),
            positionModel: new DynamicPositionModel(
                airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 70),
                airport.positionModel,
                airport.magneticNorth
            ),
            routeString: arrivalRoute
        });
        vfrArrivalYssy.groundTrack = 0;
        const vfrArrivalReject = commander.run(vfrArrivalYssy, 'freqChangeApproved', []);
        t.false(vfrArrivalReject[0]);
        t.regex(vfrArrivalReject[1], /Tower handoff/);

        // VFR departure inside YSSY Class C (15 NM north, 3000 ft) is rejected by fca
        const vfrInsideYssy = new AircraftModel({
            airline: 'vh',
            callsign: 'vin',
            airlineCallsign: '',
            rules: FLIGHT_RULES.VFR,
            category: 'departure',
            origin: 'YSSY',
            destination: '',
            altitude: 3000,
            speed: 110,
            heading: 0,
            model: new AircraftTypeDefinitionModel(c172),
            positionModel: new DynamicPositionModel(
                airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 15),
                airport.positionModel,
                airport.magneticNorth
            ),
            routeString: 'YSSY25.AVMOV1.AVMOV'
        });
        vfrInsideYssy.setFlightPhase(FLIGHT_PHASE.CLIMB);
        vfrInsideYssy.altitude = 3000;
        vfrInsideYssy.speed = 110;
        vfrInsideYssy.groundTrack = 0;
        t.true(vfrInsideYssy.isInsideAirspace(airport));
        const insideReject = commander.run(vfrInsideYssy, 'freqChangeApproved', []);
        t.false(insideReject[0]);
        t.regex(insideReject[1], /inside controlled airspace/);

        // VFR aircraft outside controlled airspace heading into controlled airspace is rejected by fca
        const vfrInbound = new AircraftModel({
            airline: 'vh',
            callsign: 'abd',
            airlineCallsign: '',
            rules: FLIGHT_RULES.VFR,
            category: 'departure',
            origin: 'YSSY',
            destination: '',
            altitude: 3000,
            speed: 110,
            heading: Math.PI,
            model: new AircraftTypeDefinitionModel(c172),
            positionModel: new DynamicPositionModel(
                airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 30),
                airport.positionModel,
                airport.magneticNorth
            ),
            routeString: 'YSSY25.AVMOV1.AVMOV'
        });
        vfrInbound.setFlightPhase(FLIGHT_PHASE.CLIMB);
        vfrInbound.altitude = 3000;
        vfrInbound.speed = 110;
        vfrInbound.groundTrack = Math.PI;
        t.false(vfrInbound.isInsideAirspace(airport));
        const inboundReject = commander.run(vfrInbound, 'freqChangeApproved', []);
        t.false(inboundReject[0]);
        t.regex(inboundReject[1], /controlled airspace ahead/);

        // Transferred departure remains simulated while inside airspace and becomes removable on airspace exit
        const frameTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp;
        TimeKeeper.getDeltaTimeForGameStateAndTimewarp = () => 1;
        try {
            const depExit = new AircraftModel({
                airline: 'qfa',
                callsign: '900',
                airlineCallsign: 'qantas',
                category: 'departure',
                origin: 'YSSY',
                destination: '',
                altitude: 10000,
                speed: 350,
                heading: 0,
                model: new AircraftTypeDefinitionModel(a320),
                positionModel: new DynamicPositionModel(
                    airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 20),
                    airport.positionModel,
                    airport.magneticNorth
                ),
                routeString: 'YSSY16R.OLSEM1.OLSEM'
            });
            depExit.setFlightPhase(FLIGHT_PHASE.CLIMB);
            depExit.altitude = 10000;
            depExit.speed = 350;
            sinon.stub(depExit, 'isTrackingOutbound').returns(true);
            depExit.fms.setDepartureOutbound('OLSEM');

            const handoff = commander.run(depExit, 'contact', ['ctr', '132.0']);
            t.true(handoff[0]);
            t.true(depExit.isInsideAirspace(airport));
            t.false(depExit.isRemovable);

            // Move outside controlled airspace and run controllability update
            depExit.positionModel = new DynamicPositionModel(
                airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 75),
                airport.positionModel,
                airport.magneticNorth
            );
            depExit._updateAircraftControllability();
            t.false(depExit.isInsideAirspace(airport));
            t.true(depExit.isRemovable);
        } finally {
            TimeKeeper.getDeltaTimeForGameStateAndTimewarp = frameTime;
        }
    } finally {
        EventBus.off(AIRCRAFT_EVENT.FREQ_CHANGE_APPROVED, onFca);
        airport.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});

test.serial('freqChangeApproved rejects VFR arrival and CTR-contained departure at DAT-imported YTES while allowing clear exit', (t) => {
    const datData = parseAirportDat([
        'RWY:RW09, , ,00050, , , , ;S34000000,E140000000,0000;',
        'RWY:RW27, , ,00050, , , , ;S34000000,E140010000,0000;'
    ].join('\n'), 'YTES.dat');
    const scope = buildDatScope(datData, resolveWaypoints(datData));
    const ytes = new AirportModel(scope);
    ytes.data = scope;
    AirportController.current = ytes;
    NavigationLibrary.init(scope);
    const commander = new AircraftCommander();

    try {
        const vfrArr = new AircraftModel({
            airline: 'vh',
            callsign: 'ta1',
            airlineCallsign: '',
            rules: FLIGHT_RULES.VFR,
            category: 'arrival',
            origin: '',
            destination: 'YTES',
            altitude: 1500,
            speed: 110,
            heading: 0,
            model: new AircraftTypeDefinitionModel(c172),
            positionModel: new DynamicPositionModel(
                ytes.positionModel.generateCoordinatesFromBearingAndDistance(0, 15),
                ytes.positionModel,
                ytes.magneticNorth
            ),
            routeString: scope.spawnPatterns.find((p) => p.category === 'arrival').route
        });
        vfrArr.groundTrack = 0;
        const arrReject = commander.run(vfrArr, 'freqChangeApproved', []);
        t.false(arrReject[0]);
        t.regex(arrReject[1], /Tower handoff/);

        const vfrDepInsideCtr = new AircraftModel({
            airline: 'vh',
            callsign: 'td1',
            airlineCallsign: '',
            rules: FLIGHT_RULES.VFR,
            category: 'departure',
            origin: 'YTES',
            destination: '',
            altitude: 1500,
            speed: 110,
            heading: 0,
            model: new AircraftTypeDefinitionModel(c172),
            positionModel: new DynamicPositionModel(
                ytes.positionModel.generateCoordinatesFromBearingAndDistance(0, 5),
                ytes.positionModel,
                ytes.magneticNorth
            ),
            routeString: scope.spawnPatterns.find((p) => p.category === 'departure').route
        });
        vfrDepInsideCtr.setFlightPhase(FLIGHT_PHASE.CLIMB);
        vfrDepInsideCtr.altitude = 1500;
        vfrDepInsideCtr.speed = 110;
        vfrDepInsideCtr.groundTrack = 0;
        t.true(vfrDepInsideCtr.isInsideAirspace(ytes));
        const ctrReject = commander.run(vfrDepInsideCtr, 'freqChangeApproved', []);
        t.false(ctrReject[0]);
        t.regex(ctrReject[1], /inside controlled airspace/);

        const vfrDepClear = new AircraftModel({
            airline: 'vh',
            callsign: 'td2',
            airlineCallsign: '',
            rules: FLIGHT_RULES.VFR,
            category: 'departure',
            origin: 'YTES',
            destination: '',
            altitude: 1500,
            speed: 110,
            heading: 0,
            model: new AircraftTypeDefinitionModel(c172),
            positionModel: new DynamicPositionModel(
                ytes.positionModel.generateCoordinatesFromBearingAndDistance(0, 15),
                ytes.positionModel,
                ytes.magneticNorth
            ),
            routeString: scope.spawnPatterns.find((p) => p.category === 'departure').route
        });
        vfrDepClear.setFlightPhase(FLIGHT_PHASE.CLIMB);
        vfrDepClear.altitude = 1500;
        vfrDepClear.speed = 110;
        vfrDepClear.groundTrack = 0;
        t.false(vfrDepClear.isInsideAirspace(ytes));
        const ok = commander.run(vfrDepClear, 'freqChangeApproved', []);
        t.true(ok[0], JSON.stringify(ok));
        t.is(ok[1].log, 'frequency change approved, good day');
    } finally {
        ytes.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});

test('commandAutocompleteConfig contact paramsets accept progressive VHF prefixes and enforce 136.975 upper bound', (t) => {
    const contactDef = commandAutocompleteConfig.transmit.find((entry) => entry.id === 'contact');
    t.truthy(contactDef);
    t.is(contactDef.paramsets.length, 2);

    const [twrParamset, ctrParamset] = contactDef.paramsets;
    const cases = [
        { paramset: twrParamset, prefix: 'twr', firstPrefix: ['t', 'tw', 'twr'] },
        { paramset: ctrParamset, prefix: 'ctr', firstPrefix: ['c', 'ct', 'ctr'] }
    ];

    for (const { paramset, prefix, firstPrefix } of cases) {
        const candidate = new RegexGroup(paramset.candidate, 'i');
        const validate = new RegExp(paramset.validate, 'i');

        const validCandidates = [
            '',
            ...firstPrefix,
            `${prefix} `,
            `${prefix} 1`,
            `${prefix} 11`,
            `${prefix} 12`,
            `${prefix} 13`,
            `${prefix} 118`,
            `${prefix} 120`,
            `${prefix} 120.`,
            `${prefix} 120.5`,
            `${prefix} 120.500`,
            `${prefix} 136`,
            `${prefix} 136.`,
            `${prefix} 136.0`,
            `${prefix} 136.899`,
            `${prefix} 136.9`,
            `${prefix} 136.96`,
            `${prefix} 136.97`,
            `${prefix} 136.975`
        ];

        for (const str of validCandidates) {
            t.true(candidate.test(str), `expected candidate to match "${str}"`);
        }

        const invalidCandidates = [
            `${prefix} 0`,
            `${prefix} 2`,
            `${prefix} 10`,
            `${prefix} 14`,
            `${prefix} 1.`,
            `${prefix} 11.`,
            `${prefix} 12.`,
            `${prefix} 13.`,
            `${prefix} 117`,
            `${prefix} 137`,
            `${prefix} 120.5000`,
            `${prefix} 136.976`,
            `${prefix} 136.98`,
            `${prefix} 136.999`
        ];

        for (const str of invalidCandidates) {
            t.false(candidate.test(str), `expected candidate to reject "${str}"`);
            t.false(validate.test(str), `expected validate to reject "${str}"`);
        }

        const validCompleted = [
            `${prefix} 118`,
            `${prefix} 118.0`,
            `${prefix} 120.5`,
            `${prefix} 120.500`,
            `${prefix} 132.0`,
            `${prefix} 135.999`,
            `${prefix} 136`,
            `${prefix} 136.000`,
            `${prefix} 136.899`,
            `${prefix} 136.9`,
            `${prefix} 136.969`,
            `${prefix} 136.97`,
            `${prefix} 136.975`
        ];

        for (const str of validCompleted) {
            t.true(validate.test(str), `expected validate to match "${str}"`);
        }

        const incompleteValidate = [
            `${prefix} `,
            `${prefix} 1`,
            `${prefix} 12`,
            `${prefix} 120.`,
            `${prefix} 136.`
        ];

        for (const str of incompleteValidate) {
            t.false(validate.test(str), `expected validate to reject incomplete "${str}"`);
        }
    }
});
