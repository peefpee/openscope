import test from 'ava';
import sinon from 'sinon';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import { AIRCRAFT_EVENT } from '../../src/assets/scripts/client/constants/eventNames';
import { CONTROLLER_TYPE, HANDOFF_STATE } from '../../src/assets/scripts/client/constants/controllerConstants';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import EventBus from '../../src/assets/scripts/client/lib/EventBus';
import ScoreController from '../../src/assets/scripts/client/game/ScoreController';
import GameController, { GAME_EVENTS } from '../../src/assets/scripts/client/game/GameController';
import a320 from '../../assets/aircraft/a320.json';
import yssyData from '../../assets/airports/yssy.json';
import { ARRIVAL_AIRCRAFT_INIT_PROPS_MOCK } from './_mocks/aircraftMocks';

test('tower accept and missed handoff drive controller state and scoring events', (t) => {
    const airport = new AirportModel(yssyData);
    const plane = new AircraftModel({ ...ARRIVAL_AIRCRAFT_INIT_PROPS_MOCK, model: new AircraftTypeDefinitionModel(a320) });
    const events = [];
    const handler = () => events.push(AIRCRAFT_EVENT.MISSED_TOWER_HANDOFF);
    const recorded = sinon.stub(GameController, 'events_recordNew');
    const uiLogStub = sinon.stub(UiController, 'ui_log');
    const scoreController = new ScoreController();

    EventBus.on(AIRCRAFT_EVENT.MISSED_TOWER_HANDOFF, handler);

    try {
        airport.towerController.acceptArrival(plane);
        t.true(airport.towerController._arrivals.has(plane.id));

        airport.towerController._triggerMissedHandoffGoAround(plane);
        t.true(events.includes(AIRCRAFT_EVENT.MISSED_TOWER_HANDOFF));
        t.true(recorded.calledWith(GAME_EVENTS.MISSED_TOWER_HANDOFF));
        t.is(plane.controllerState.handoffState, HANDOFF_STATE.NONE);
    } finally {
        EventBus.off(AIRCRAFT_EVENT.MISSED_TOWER_HANDOFF, handler);
        scoreController.disable();
        uiLogStub.restore();
        recorded.restore();
    }
});

test('departure transfer moves an aircraft to the player and centre accepts handoffs', (t) => {
    const airport = new AirportModel(yssyData);
    const uiLogStub = sinon.stub(UiController, 'ui_log');
    const departure = new AircraftModel({
        ...ARRIVAL_AIRCRAFT_INIT_PROPS_MOCK,
        model: new AircraftTypeDefinitionModel(a320),
        category: 'departure'
    });

    departure.setControllerState({ currentController: CONTROLLER_TYPE.TWR });
    airport.towerController.transferDepartureToPlayer(departure);
    t.is(departure.controllerState.currentController, CONTROLLER_TYPE.APP);
    t.true(departure.awaitingIdentification);

    airport.centreController.acceptDeparture(departure);
    t.true(airport.centreController._aircraft.has(departure.id));

    airport.centreController.reset();
    t.is(airport.centreController._aircraft.size, 0);
    uiLogStub.restore();
});
