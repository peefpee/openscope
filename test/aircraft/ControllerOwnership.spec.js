/* global prop */
import test from 'ava';
import sinon from 'sinon';
import AircraftCommander from '../../src/assets/scripts/client/aircraft/AircraftCommander';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import CommandParser from '../../src/assets/scripts/client/commands/parsers/CommandParser';
import { CONTROLLER_TYPE, HANDOFF_STATE } from '../../src/assets/scripts/client/constants/controllerConstants';
import { FLIGHT_RULES } from '../../src/assets/scripts/client/constants/aircraftConstants';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import a320 from '../../assets/aircraft/a320.json';
import yssyData from '../../assets/airports/yssy.json';
import { AIRPORT_JSON_KLAS_MOCK } from '../airport/_mocks/airportJsonMock';

function createYssyAircraft(overrides = {}) {
    const airport = AirportController.airport_get();
    const runway = airport.arrivalRunwayModel;

    return new AircraftModel({
        airline: 'qfa',
        callsign: '412',
        airlineCallsign: 'qantas',
        category: 'arrival',
        origin: '',
        destination: 'YSSY',
        altitude: 8000,
        speed: 220,
        heading: runway.angle,
        model: new AircraftTypeDefinitionModel(a320),
        positionModel: runway.positionModel.generateDynamicPositionFromBearingAndDistance(Math.PI, 15),
        routeString: yssyData.spawnPatterns.find((p) => p.category === 'arrival').route,
        ...overrides
    });
}

test.serial('initializes Australian controllerState fields cleanly and preserves international airports', (t) => {
    const yssy = new AirportModel(yssyData);
    yssy.data = yssyData;
    AirportController.current = yssy;
    NavigationLibrary.init(yssyData);
    const uiLogStub = sinon.stub(UiController, 'ui_log');
    const previousSpeech = prop.speech;
    prop.speech = { enabled: false };

    try {
        const ifrArrival = createYssyAircraft();
        t.is(ifrArrival.controllerState.currentController, CONTROLLER_TYPE.NONE);
        t.is(ifrArrival.controllerState.handoffState, HANDOFF_STATE.NONE);
        t.is(ifrArrival.controllerState.recommendedFrequency, null);
        t.is(ifrArrival.controllerState.recommendedSector, null);
        t.is(ifrArrival.controllerState.handoffEventId, null);
        t.false(ifrArrival.controllerState.airspaceEntryCleared);
        t.is(ifrArrival.controllerState.lastBoundaryWarningTime, 0);
        t.false(ifrArrival.isPlayerControlled());
        t.false(ifrArrival.isControllable);

        // Entering airspace transitions IFR arrival NONE -> APP
        ifrArrival._updateAircraftControllability();
        t.is(ifrArrival.controllerState.currentController, CONTROLLER_TYPE.APP);
        t.is(ifrArrival.controllerState.currentFrequency, '124.400');
        t.true(ifrArrival.isPlayerControlled());
        t.true(ifrArrival.isControllable);

        // Transferring to TWR locks player controllability even inside airspace
        ifrArrival.setControllerState({
            currentController: CONTROLLER_TYPE.TWR,
            currentFrequency: '120.500',
            handoffState: HANDOFF_STATE.COMPLETED,
            handoffCompleted: true
        });
        t.false(ifrArrival.isPlayerControlled());
        t.false(ifrArrival.isControllable);
        ifrArrival._updateAircraftControllability();
        t.is(ifrArrival.controllerState.currentController, CONTROLLER_TYPE.TWR);
        t.false(ifrArrival.isControllable);
        t.false(ifrArrival.isRemovable);

        // Projected clones never mutate controllerState
        ifrArrival.projected = true;
        ifrArrival.setControllerState({ currentController: CONTROLLER_TYPE.APP });
        t.is(ifrArrival.controllerState.currentController, CONTROLLER_TYPE.TWR);
        ifrArrival.projected = false;

        // VFR arrival initializes to APP
        const vfrArrival = createYssyAircraft({ rules: FLIGHT_RULES.VFR, callsign: '101' });
        t.is(vfrArrival.controllerState.currentController, CONTROLLER_TYPE.APP);
        t.true(vfrArrival.isPlayerControlled());

        // Departure initializes to TWR on Australian towered airports
        const dep = createYssyAircraft({
            category: 'departure',
            origin: 'YSSY',
            destination: '',
            altitude: 21,
            speed: 0,
            routeString: 'YSSY25.AVMOV1.AVMOV'
        });
        t.is(dep.controllerState.currentController, CONTROLLER_TYPE.TWR);
        t.is(dep.controllerState.currentFrequency, '120.500');
        t.false(dep.isPlayerControlled());
    } finally {
        prop.speech = previousSpeech;
        uiLogStub.restore();
        yssy.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }

    // International airport preserves legacy isControllable behavior
    const klas = new AirportModel(AIRPORT_JSON_KLAS_MOCK);
    klas.data = AIRPORT_JSON_KLAS_MOCK;
    AirportController.current = klas;
    NavigationLibrary.init(AIRPORT_JSON_KLAS_MOCK);
    try {
        const klasDep = new AircraftModel({
            airline: 'ual',
            callsign: '100',
            airlineCallsign: 'united',
            category: 'departure',
            origin: 'KLAS',
            destination: '',
            altitude: 2181,
            speed: 0,
            heading: 0,
            model: new AircraftTypeDefinitionModel(a320),
            positionModel: klas.positionModel.generateDynamicPositionFromBearingAndDistance(0, 0),
            routeString: 'KLAS07R.COWBY6.GUP'
        });
        t.false(klasDep.isAustralianOperation());
        t.true(klasDep.isControllable);
        t.true(klasDep.isPlayerControlled());
    } finally {
        klas.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});

test.serial('runCommands enforces ownership on Australian airports and halts chained commands after transfer', (t) => {
    const yssy = new AirportModel(yssyData);
    yssy.data = yssyData;
    AirportController.current = yssy;
    NavigationLibrary.init(yssyData);
    const uiLogStub = sinon.stub(UiController, 'ui_log');
    const previousSpeech = prop.speech;
    prop.speech = { enabled: false };
    const commander = new AircraftCommander();

    try {
        const arrival = createYssyAircraft();
        arrival.setControllerState({
            currentController: CONTROLLER_TYPE.TWR,
            currentFrequency: '120.500',
            handoffState: HANDOFF_STATE.COMPLETED
        });

        const rejected = commander.runCommands(
            arrival,
            new CommandParser('QFA412 h 180').parse().args
        );
        t.false(rejected);
        t.true(uiLogStub.calledOnce);
        t.true(uiLogStub.lastCall.args[1]);
        t.regex(uiLogStub.lastCall.args[0], /Tower frequency/);

        // Chained commands halt immediately once ownership transfers to TWR
        const eligibleArrival = createYssyAircraft({
            callsign: '413',
            controllerState: {
                currentController: CONTROLLER_TYPE.APP,
                currentFrequency: '124.400',
                handoffState: HANDOFF_STATE.REQUIRED
            }
        });
        eligibleArrival.fms.setArrivalRunway(yssy.getRunway('16R'));
        eligibleArrival.pilot.hasApproachClearance = true;
        sinon.stub(eligibleArrival, 'isEstablishedOnCourse').returns(true);

        const initialHeading = eligibleArrival.mcp.heading;
        const chainedResult = commander.runCommands(
            eligibleArrival,
            new CommandParser('QFA413 contact twr 120.5 h 090').parse().args
        );
        t.true(chainedResult);
        t.is(eligibleArrival.controllerState.currentController, CONTROLLER_TYPE.TWR);
        t.false(eligibleArrival.isPlayerControlled());
        t.is(eligibleArrival.mcp.heading, initialHeading);
    } finally {
        prop.speech = previousSpeech;
        uiLogStub.restore();
        yssy.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});
