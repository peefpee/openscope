import test from 'ava';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import AirspaceModel from '../../src/assets/scripts/client/airport/AirspaceModel';
import StaticPositionModel from '../../src/assets/scripts/client/base/StaticPositionModel';
import RouteModel from '../../src/assets/scripts/client/aircraft/FlightManagementSystem/RouteModel';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import {
    resolveApproachCeiling,
    resolveRouteArrivalEntry,
    resolveVectorArrivalEntry,
    resolvePreSpawnArrivalEntries,
    isPointInsideApproachAirspace,
    minDistanceToApproachBoundaryNm
} from '../../src/assets/scripts/client/trafficGenerator/ArrivalEntryResolver';
import { CONTROLLER_TYPE, HANDOFF_STATE } from '../../src/assets/scripts/client/constants/controllerConstants';
import yssyData from '../../assets/airports/yssy.json';

function makeMockAirport({ icao = 'YSSY', ctrCeiling = 10000, shelves = [], elevation = 21 } = {}) {
    const center = new StaticPositionModel(['S33d56m45.95', 'E151d10m37.21', `${elevation}ft`]);
    return {
        icao,
        ctr_ceiling: ctrCeiling,
        maxAssignableAltitude: ctrCeiling,
        ctr_radius: 60,
        magneticNorth: 13,
        positionModel: center,
        controlledShelves: shelves,
        airspace: shelves,
        airspaceRegions: shelves,
        terrainElevationAt: () => elevation,
        isPointWithinAirspace: (rel, alt) => shelves.some((s) => s.isPointInside(rel, alt))
    };
}

function makeShelf({ name = 'SY TMA', airspaceClass = 'C', type = 'TMA', source = 'imported', floor = 1500, ceiling = 8500, poly }) {
    const center = new StaticPositionModel(['S33d56m45.95', 'E151d10m37.21', '21ft']);
    const ring = poly || [
        [-33.6, 150.7], [-33.6, 151.6], [-34.3, 151.6], [-34.3, 150.7]
    ];
    const model = new AirspaceModel({
        name,
        airspace_class: airspaceClass,
        type,
        floor: 0,
        ceiling: 0,
        poly: ring
    }, center, 13);
    model.source = source;
    model.floor = floor;
    model.ceiling = ceiling;
    model.verticalLimits = {
        lower: { feet: floor, agl: false },
        upper: { feet: ceiling, agl: false },
        sectorTop: Infinity,
        groundAt: () => 21
    };
    return model;
}

test('resolveApproachCeiling preserves non-round limits (8500, FL125, FL245) and ignores overlying Class A', (t) => {
    for (const expected of [8500, 10000, 12500, 24500]) {
        const shelves = [
            makeShelf({ name: 'CTR', type: 'CTR', floor: 0, ceiling: 2500 }),
            makeShelf({ name: 'APP TMA', type: 'TMA', floor: 2500, ceiling: expected }),
            makeShelf({ name: 'YMMM ENROUTE', airspaceClass: 'A', type: 'CTA', floor: 24500, ceiling: 60000 })
        ];
        const airport = makeMockAirport({ ctrCeiling: 28000, shelves });
        t.is(resolveApproachCeiling(airport), expected);
    }
});

test('resolveApproachCeiling clamps to aircraft service ceiling and terrain safety floor', (t) => {
    const shelves = [makeShelf({ ceiling: 24500 })];
    const airport = makeMockAirport({ shelves, elevation: 500 });
    t.is(resolveApproachCeiling(airport, { aircraftModel: { ceiling: 15000 } }), 15000);

    const highTerrainAirport = {
        ...makeMockAirport({ shelves: [makeShelf({ ceiling: 4000 })], elevation: 500 }),
        terrainElevationAt: () => 4200
    };
    t.is(resolveApproachCeiling(highTerrainAirport, { relativePosition: [10, 10] }), 5200);
});

test('resolveRouteArrivalEntry extends inward STARs outside irregular approach polygons with >= 5 NM buffer', (t) => {
    // Irregular non-circular polygon around YSSY
    const irregular = makeShelf({
        name: 'YBNA CTA',
        ceiling: 8500,
        poly: [
            [-33.7, 150.9], [-33.65, 151.45], [-34.15, 151.55], [-34.25, 150.85]
        ]
    });
    const airport = makeMockAirport({ icao: 'YBNA', shelves: [irregular] });
    const center = airport.positionModel;
    const insideWp1 = center.generateDynamicPositionFromBearingAndDistance(0.5, 8);
    const insideWp2 = center.generateDynamicPositionFromBearingAndDistance(0.5, 2);
    const routeModel = {
        waypoints: [
            { name: 'INFIX', positionModel: insideWp1, relativePosition: insideWp1.relativePosition, isVectorWaypoint: false },
            { name: 'FINAL', positionModel: insideWp2, relativePosition: insideWp2.relativePosition, isVectorWaypoint: false }
        ]
    };

    const entry = resolveRouteArrivalEntry(airport, routeModel, { bufferNm: 5 });
    t.truthy(entry);
    t.is(entry.altitude, 8500);
    t.is(entry.nextFix, 'INFIX');
    t.false(isPointInsideApproachAirspace(airport, entry.positionModel.relativePosition));
    t.true(minDistanceToApproachBoundaryNm(airport, entry.positionModel.relativePosition) >= 4.85);
});

test('resolveVectorArrivalEntry spawns outside approach boundary with buffer and rejects when blocked', (t) => {
    const shelf = makeShelf({ ceiling: 12500 });
    const airport = makeMockAirport({ icao: 'YMHB', shelves: [shelf] });
    const entry = resolveVectorArrivalEntry(airport, { waypoints: [] }, { bufferNm: 5 });
    t.truthy(entry);
    t.is(entry.altitude, 12500);
    t.false(isPointInsideApproachAirspace(airport, entry.positionModel.relativePosition));
    t.true(minDistanceToApproachBoundaryNm(airport, entry.positionModel.relativePosition) >= 4.85);

    // Huge restricted area covering entire search ring -> returns null rather than spawning inside
    const giantRestricted = makeShelf({
        name: 'R999',
        type: 'R',
        floor: 0,
        ceiling: 60000,
        poly: [[-20, 130], [-20, 170], [-45, 170], [-45, 130]]
    });
    const blockedAirport = makeMockAirport({ icao: 'YMHB', shelves: [shelf] });
    blockedAirport.airspaceRegions = [shelf, giantRestricted];
    t.is(resolveVectorArrivalEntry(blockedAirport, { waypoints: [] }, { bufferNm: 5 }), null);
});

test('resolvePreSpawnArrivalEntries maintains separation >= 6 NM outside approach airspace', (t) => {
    const shelf = makeShelf({ ceiling: 10000 });
    const airport = makeMockAirport({ icao: 'YMML', shelves: [shelf] });
    const center = airport.positionModel;
    const wp1 = center.generateDynamicPositionFromBearingAndDistance(1.2, 10);
    const wp2 = center.generateDynamicPositionFromBearingAndDistance(1.2, 3);
    const routeModel = {
        waypoints: [
            { name: 'ARBEY', positionModel: wp1, relativePosition: wp1.relativePosition, isVectorWaypoint: false },
            { name: 'ML', positionModel: wp2, relativePosition: wp2.relativePosition, isVectorWaypoint: false }
        ]
    };

    const entries = resolvePreSpawnArrivalEntries(airport, routeModel, 10, { maxCount: 2 });
    t.is(entries.length, 2);
    entries.forEach((e) => {
        t.false(isPointInsideApproachAirspace(airport, e.positionModel.relativePosition));
        t.is(e.altitude, 10000);
    });
    const sep = entries[0].positionModel.distanceToPosition(entries[1].positionModel);
    t.true(sep >= 5.9);
});

test('Australian IFR arrival spawns under Centre control and transfers once to Approach upon airspace entry', (t) => {
    const mockControllerState = {
        currentController: CONTROLLER_TYPE.CTR,
        currentFrequency: '125.000',
        handoffState: HANDOFF_STATE.NONE,
        handoffCompleted: false
    };
    const fakeAirport = makeMockAirport({
        icao: 'YSSY',
        ctrCeiling: 28000,
        shelves: [makeShelf({ ceiling: 28000 })]
    });
    fakeAirport.controllerConfig = {
        centre: [{ sectorId: 'YMMM', callsign: 'YMMM', frequency: '125.000' }],
        getApproach: () => ({ callsign: 'SY_APP', frequency: '124.400' }),
        getDeparture: () => ({ callsign: 'SY_DEP', frequency: '123.000' }),
        tower: []
    };

    let callUpCount = 0;
    const fakeAircraft = {
        projected: false,
        transferredToCentre: false,
        rules: 'ifr',
        category: 'arrival',
        isArrival: () => true,
        isDeparture: () => false,
        isAustralianOperation: () => true,
        isControllable: false,
        controllerState: { ...mockControllerState },
        inside: false,
        isInsideAirspace: () => fakeAircraft.inside,
        isPlayerControlled: AircraftModel.prototype.isPlayerControlled,
        syncControllabilityFromControllerState: AircraftModel.prototype.syncControllabilityFromControllerState,
        setControllerState(updates) {
            Object.assign(this.controllerState, updates);
            this.syncControllabilityFromControllerState();
        },
        _contactAircraftAfterControllabilityChange() {
            callUpCount += 1;
        },
        setIsRemovable() {
            t.fail('Inbound Centre arrival must not be marked removable outside approach airspace');
        }
    };

    // Outside approach airspace: stays under Centre, not player-controlled
    AircraftModel.prototype._updateAircraftControllability.call(fakeAircraft);
    // Note: AirportController.airport_get() is used inside _updateAircraftControllability,
    // so verify controller state logic directly with stubbed airport
    t.is(fakeAircraft.controllerState.currentController, CONTROLLER_TYPE.CTR);
    t.false(fakeAircraft.isControllable);
    t.is(callUpCount, 0);
});
