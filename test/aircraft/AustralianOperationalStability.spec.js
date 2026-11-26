/* global prop */
import test from 'ava';
import sinon from 'sinon';
import AircraftCommander from '../../src/assets/scripts/client/aircraft/AircraftCommander';
import AircraftController from '../../src/assets/scripts/client/aircraft/AircraftController';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import ClearanceStateManager from '../../src/assets/scripts/client/aircraft/ClearanceStateManager';
import { enforceOcta, trajectory } from '../../src/assets/scripts/client/aircraft/Pilot/Trajectory';
import { clearOrbit } from '../../src/assets/scripts/client/aircraft/Pilot/VfrArrival';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import { parseAirportDat } from '../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../src/assets/scripts/client/airport/dat/buildDatScope';
import { readOpenAir } from '../../src/assets/scripts/client/airport/dat/parseOpenAir';
import CommandParser from '../../src/assets/scripts/client/commands/parsers/CommandParser';
import TimeKeeper from '../../src/assets/scripts/client/engine/TimeKeeper';
import EventBus from '../../src/assets/scripts/client/lib/EventBus';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import StaticPositionModel from '../../src/assets/scripts/client/base/StaticPositionModel';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import { CONTROLLER_TYPE, HANDOFF_STATE } from '../../src/assets/scripts/client/constants/controllerConstants';
import { FLIGHT_PHASE } from '../../src/assets/scripts/client/constants/aircraftConstants';
import { degreesToRadians } from '../../src/assets/scripts/client/utilities/unitConverters';
import a320 from '../../assets/aircraft/a320.json';
import c172 from '../../assets/aircraft/c172.json';
import yssyData from '../../assets/airports/yssy.json';
import kbosData from '../../assets/airports/kbos.json';

function setupAirport(data = yssyData) {
    const airport = new AirportModel(data);
    airport.data = data;
    AirportController.current = airport;
    NavigationLibrary.reset();
    NavigationLibrary.init(data);
    return airport;
}

function makeAircraft(airport, modelJson, overrides = {}) {
    const model = new AircraftTypeDefinitionModel(modelJson);
    const positionModel = airport.positionModel.generateDynamicPositionFromBearingAndDistance(
        degreesToRadians(overrides.bearingDeg != null ? overrides.bearingDeg : 180),
        overrides.distanceNm != null ? overrides.distanceNm : 14
    );
    const isDep = overrides.category === 'departure';
    const defaultPattern = (airport.data.spawnPatterns || []).find((p) => p.category === (isDep ? 'departure' : 'arrival'));
    const ac = new AircraftModel({
        airline: overrides.airline || (overrides.rules === 'vfr' ? 'vh' : 'qfa'),
        airlineCallsign: overrides.airlineCallsign || (overrides.rules === 'vfr' ? 'vh' : 'qfa'),
        callsign: overrides.callsign || (overrides.rules === 'vfr' ? 'ABC' : '401'),
        category: overrides.category || 'arrival',
        origin: '',
        destination: airport.icao,
        rules: overrides.rules || 'ifr',
        positionModel,
        altitude: overrides.altitude != null ? overrides.altitude : 3000,
        speed: overrides.speed != null ? overrides.speed : model.speed.cruise,
        heading: overrides.heading != null ? overrides.heading : 0,
        model,
        routeString: overrides.routeString || (defaultPattern ? defaultPattern.route : 'MARLN'),
        transponderCode: overrides.rules === 'vfr' ? 1200 : 3412
    });
    ac.trueAirspeed = ac.speed;
    if (overrides.controller) {
        ac.setControllerState({ currentController: overrides.controller });
    }
    return ac;
}

function runCmd(commander, ac, text) {
    const parsed = new CommandParser(`${ac.callsign} ${text}`).parse();
    const [cmd, ...args] = parsed.args[0];
    return commander.run(ac, cmd, args);
}

test.serial('1-4. VFR OCTA protection, shelf climb protection, entry clearance, and OCTA revocation', (t) => {
    const dat = parseAirportDat('RWY:RW18, , ,00010, , , , ;S37000000,E145000000,0000;\nRWY:RW36, , ,00010, , , , ;S37010000,E145000000,0000;', 'YTES.dat');
    const datScope = buildDatScope(dat, resolveWaypoints(dat));
    const airport = setupAirport(datScope);
    const commander = new AircraftCommander();
    const logStub = sinon.stub(UiController, 'ui_log');
    try {
        // 1. Approaching 10 NM Class C CTR boundary without clearance triggers avoidance
        const ac = makeAircraft(airport, c172, { rules: 'vfr', distanceNm: 10.8, bearingDeg: 180, altitude: 1500, heading: 0, routeString: '' });
        ac.octaRequired = true;
        ac.controllerState.currentController = CONTROLLER_TYPE.APP;
        ac.isControllable = true;

        ac.targetHeading = 0;
        ac.target.altitude = 1500;
        ac.nextOctaCheck = 0;
        enforceOcta(ac, airport, 100);
        t.true(['avoidance', 'unavoidable_infringement', 'predicted_infringement', 'actual_infringement'].includes(ac.octaStatus));

        // 2. Attempting to climb into 2010 ft CTA shelf while OCTA levels off safely
        const ac2 = makeAircraft(airport, c172, { rules: 'vfr', distanceNm: 15, bearingDeg: 0, altitude: 1500, heading: 0 });
        ac2.positionModel = new StaticPositionModel(
            airport.positionModel.generateCoordinatesFromBearingAndDistance(0, 15),
            airport.positionModel,
            airport.magneticNorth
        );
        ac2.altitude = 1500;
        ac2.octaRequired = true;
        ac2.controllerState.currentController = CONTROLLER_TYPE.APP;
        ac2.isControllable = true;
        ac2.radioCall = () => {};
        runCmd(commander, ac2, 'a 40');
        ac2.nextOctaCheck = 0;
        ac2.updateTarget();
        enforceOcta(ac2, airport, 105);
        const hits = airport.getAirspaceAtPosition(ac2.relativePosition, ac2.altitude).map((a) => `${a.type}:${a.floor}-${a.ceiling}`);
        t.true(ac2.target.altitude <= 2000, `alt=${ac2.target.altitude} cur=${ac2.altitude} pos=${ac2.relativePosition} hits=${hits} status=${ac2.octaStatus}`);

        // 3. Receiving controlled-airspace entry clearance authorises entry and clears OCTA
        const [ok] = runCmd(commander, ac2, 'clearentry');
        t.true(ok);
        t.truthy(ac2.entryClearance);
        t.true(ac2.entryClearance.valid);
        t.false(ac2.octaRequired);

        // 4. Instructing OCTA after entry clearance revokes entry clearance cleanly
        const [octaOk] = runCmd(commander, ac2, 'octa');
        t.true(octaOk);
        t.true(ac2.octaRequired);
        t.is(ac2.entryClearance, null);
        t.false(ac2.controllerState.airspaceEntryCleared);
    } finally {
        logStub.restore();
        airport.releaseWindListener();
    }
});

test.serial('5-9. VFR circuit + Tower handoff, IFR ILS/RNAV handoff, missed handoff go-around, and resequencing', (t) => {
    const airport = setupAirport(yssyData);
    const commander = new AircraftCommander();
    const logStub = sinon.stub(UiController, 'ui_log');
    try {
        // 5. VFR joining downwind and transferring to Tower (requires entryClearance)
        const vfr = makeAircraft(airport, c172, { rules: 'vfr', distanceNm: 8, bearingDeg: 270, altitude: 1500 });
        vfr.octaRequired = true;
        vfr.setControllerState({ currentController: CONTROLLER_TYPE.APP });
        runCmd(commander, vfr, 'dw 34L');
        const [blockedHandoff] = runCmd(commander, vfr, 'contact twr 120.5');
        t.false(blockedHandoff);
        runCmd(commander, vfr, 'clearentry');
        const [vfrHandoff] = runCmd(commander, vfr, 'contact twr 120.5');
        t.true(vfrHandoff);

        // 6. IFR established on ILS transferring to Tower
        const rwy34L = airport.getRunway('34L');
        const ifrIls = makeAircraft(airport, a320, { distanceNm: 8, bearingDeg: 162, altitude: 2500, heading: rwy34L.angle });
        ifrIls.setControllerState({ currentController: CONTROLLER_TYPE.APP });
        ifrIls.fms.setArrivalRunway(rwy34L);
        ifrIls.positionModel = rwy34L.positionModel.generateDynamicPositionFromBearingAndDistance(rwy34L.oppositeAngle, 8);
        ifrIls.heading = rwy34L.angle;
        ifrIls.groundTrack = rwy34L.angle;
        ifrIls.pilot.conductInstrumentApproach(ifrIls, 'ils', rwy34L);
        const [ilsHandoff, ilsMsg] = runCmd(commander, ifrIls, 'contact twr 120.5');
        t.true(ilsHandoff, String(ilsMsg));

        // 7 & 8 & 9. IFR missed Tower handoff triggers go-around and allows resequencing
        const ifrMissed = makeAircraft(airport, a320, { callsign: '402', distanceNm: 1.5, bearingDeg: 162, altitude: 600, heading: rwy34L.angle });
        ifrMissed.setControllerState({ currentController: CONTROLLER_TYPE.APP });
        ifrMissed.fms.setArrivalRunway(rwy34L);
        ifrMissed.pilot.hasApproachClearance = true;
        ifrMissed.positionModel = rwy34L.positionModel.generateDynamicPositionFromBearingAndDistance(rwy34L.oppositeAngle, 1.5);
        ifrMissed.heading = rwy34L.angle;
        ifrMissed.groundTrack = rwy34L.angle;
        ifrMissed.landingClearance = { runway: '34L', issuer: 'TWR', issued: 10 };
        const wentAround = airport.towerController.updateArrivalHandoff(ifrMissed, [ifrMissed]);
        t.true(wentAround);
        t.is(ifrMissed.landingClearance, null);
        t.is(ifrMissed.circuitPhase, 'GO AROUND');
        t.true(ifrMissed.isPlayerControlled());
        // Resequence after go-around
        const [reseq] = runCmd(commander, ifrMissed, 'h 090');
        t.true(reseq);
    } finally {
        logStub.restore();
        airport.releaseWindListener();
    }
});

test.serial('10-16. Runway sequencing, departure conflict, wrong freq, clearance cancellation, runway change, direct-to OCTA', (t) => {
    const airport = setupAirport(yssyData);
    const commander = new AircraftCommander();
    const logStub = sinon.stub(UiController, 'ui_log');
    try {
        const rwy34L = airport.getRunway('34L');

        // 10. Multiple aircraft approaching same runway: trailing aircraft within separation does not get landing clearance
        const lead = makeAircraft(airport, a320, { callsign: '501', distanceNm: 2, altitude: 700 });
        const trail = makeAircraft(airport, a320, { callsign: '502', distanceNm: 3.5, altitude: 1200 });
        [lead, trail].forEach((ac) => {
            ac.fms.setArrivalRunway(rwy34L);
            ac.pilot.hasApproachClearance = true;
            ac.setControllerState({ currentController: CONTROLLER_TYPE.TWR });
            airport.towerController.acceptArrival(ac);
        });
        lead.positionModel.setCoordinates(rwy34L.positionModel.generateCoordinatesFromBearingAndDistance(rwy34L.oppositeAngle, 2));
        trail.positionModel.setCoordinates(rwy34L.positionModel.generateCoordinatesFromBearingAndDistance(rwy34L.oppositeAngle, 3.5));
        airport.towerController.manageLandingClearance(lead, [lead, trail]);
        airport.towerController.manageLandingClearance(trail, [lead, trail]);
        t.truthy(lead.landingClearance);
        t.is(trail.landingClearance, null);

        // 11. Arrival/departure runway conflict blocks departure
        const dep = makeAircraft(airport, a320, { callsign: '503', category: 'departure', distanceNm: 0, altitude: 21 });
        dep.fms.setDepartureRunway(rwy34L);
        dep.setFlightPhase(FLIGHT_PHASE.WAITING);
        t.false(airport.towerController.isRunwayClearForDeparture(dep, rwy34L, [lead, dep]));

        // 12. Incorrect Tower frequency rejected
        lead.setControllerState({ currentController: CONTROLLER_TYPE.APP });
        const [badFreq] = runCmd(commander, lead, 'contact twr 118.9');
        t.false(badFreq);

        // 13. Approach clearance cancellation clears landing clearance
        lead.pilot.cancelApproachClearance(lead);
        t.is(lead.landingClearance, null);
        t.false(lead.pilot.hasApproachClearance);

        // 14. Runway reassignment invalidates incompatible landing/approach clearance
        lead.pilot.hasApproachClearance = true;
        lead.landingClearance = { runway: '34L', issuer: 'TWR', issued: 10 };
        ClearanceStateManager.onArrivalRunwayChanged(lead, airport.getRunway('16R'));
        t.is(lead.landingClearance, null);

        // 15 & 16. Direct-to while OCTA preserves octaRequired & clearOrbit stays outside controlled airspace
        const vfr = makeAircraft(airport, c172, { rules: 'vfr', distanceNm: 15, bearingDeg: 270, altitude: 1500 });
        vfr.octaRequired = true;
        vfr.setControllerState({ currentController: CONTROLLER_TYPE.APP });
        runCmd(commander, vfr, 'dct MARLN');
        t.true(vfr.octaRequired);
        const orbit = clearOrbit(airport, vfr.positionModel, 1500, 105, 20);
        if (orbit) {
            t.false(airport.getAirspaceAtPosition(orbit.center.relativePosition, 1500).some((a) => !airport.isAirspaceEntryAuthorised(vfr, a)));
        }
    } finally {
        logStub.restore();
        airport.releaseWindListener();
    }
});

test.serial('17-24. OpenAir diagnostics, airport switching, ownership rejection, non-AU regression, pure trajectory, cleanup', (t) => {
    // 18. Incomplete Australian airspace diagnostics
    const openAir = readOpenAir('AC C\nAN TEST CTA\nAL 2000 MSL\nAH 8500 MSL\nDP 33:50:00 S 151:00:00 E\nDP 33:50:00 S 151:20:00 E\nDP 34:10:00 S 151:10:00 E\nAC D\nAN BAD\nDP 33:50:00 S 151:00:00 E');
    t.is(openAir.accepted, 1);
    t.is(openAir.rejected, 1);
    t.true(openAir.coverageLimitations);

    const yssy = setupAirport(yssyData);
    t.true(yssy.controlledShelves.length > 0);
    const commander = new AircraftCommander();
    const ac = makeAircraft(yssy, a320, { callsign: '701', distanceNm: 10, altitude: 3000 });
    ac.setControllerState({ currentController: CONTROLLER_TYPE.TWR });
    const logStub = sinon.stub(UiController, 'ui_log');
    try {
        // 21. Ownership rejection after handoff
        t.false(commander.runCommands(ac, [['fh']]));
    } finally {
        logStub.restore();
    }

    // 23. Projected trajectories do not mutate live aircraft state
    const beforePos = [...ac.relativePosition];
    const beforeAlt = ac.altitude;
    const beforeHdg = ac.heading;
    const samples = trajectory(ac, yssy, 60, ac.heading + 0.5, ac.altitude + 1000, true);
    t.true(samples.length > 0);
    t.deepEqual(ac.relativePosition, beforePos);
    t.is(ac.altitude, beforeAlt);
    t.is(ac.heading, beforeHdg);

    // 24. Aircraft removal cleans up conflicts, projections, and tower tracking
    ac.conflictProjection = { expires: 999, samples };
    yssy.towerController.acceptArrival(ac);
    const mockController = {
        aircraft: { list: [ac] },
        removeFlightNumberFromList: () => {},
        removeAircraftModelFromList: () => { mockController.aircraft.list = []; },
        _removeTransponderCodeFromUse: () => {},
        removeAllAircraftConflictsForAircraft: () => {},
        removeStripView: () => {},
        _scopeModel: { radarTargetCollection: { removeRadarTargetModelForAircraftModel: () => {} } }
    };
    AircraftController.prototype.aircraft_remove.call(mockController, ac);
    t.is(ac.conflictProjection, null);
    t.false(yssy.towerController._arrivals.has(ac.id));

    // 19 & 22. Switching between Australian and non-Australian airports preserves KBOS behaviour
    yssy.releaseWindListener();
    const kbos = setupAirport(kbosData);
    t.false(Boolean(kbos.towerController && kbos.towerController.isActive));
    kbos.releaseWindListener();
});
