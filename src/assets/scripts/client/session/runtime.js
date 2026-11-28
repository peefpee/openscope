import $ from 'jquery';
import { applyScopeControls } from '../ui/ScopeControls';
import App from '../App';
import GameController from '../game/GameController';
import TimeKeeper from '../engine/TimeKeeper';
import navData from '../airport/dat/NavDataCache';

export default async function startRadar(session) {
    const bridge = { ...session, suspended: false };
    window.sessionBridge = bridge;
    const apply = (settings) => {
        bridge.settings = settings;
        if (window.prop && window.prop.speech) window.prop.speech.enabled = settings.enabled;
        for (const [key, value] of Object.entries(settings.radar)) {
            if (GameController.game.option[key] !== value) GameController.game.option.setOptionByName(key, value);
        }
    };
    const cancelSpeech = () => { if (window.speechSynthesis) window.speechSynthesis.cancel(); };
    session.runtime = {
        apply,
        setControls: applyScopeControls,
        pause() {
            bridge.suspended = true;
            GameController.game_pause();
            cancelSpeech();
        },
        resume() {
            cancelSpeech();
            bridge.suspended = false;
            GameController.game_unpause();
            TimeKeeper.setPause(!document.hasFocus());
        },
        stop() {
            bridge.suspended = true;
            cancelSpeech();
            GameController.destroyTimers();
        },
        snapshot: () => ({
            score: GameController.game.score,
            events: { ...GameController.game.events },
            history: GameController.game.history.slice(),
            simulatedSeconds: TimeKeeper.accumulatedDeltaTime
        })
    };
    try {
        if (session.stage) session.stage('Reading navigation data');
        await navData.load();
        if (bridge.suspended) return;
        for (const [key, value] of session.navRecords) navData.records.set(key, value);
        const airport = JSON.parse(JSON.stringify(session.airport));
        document.getElementById('dat-import').remove();
        document.getElementById('session-menu').remove();
        document.getElementById('radar-workspace').replaceWith(...document.getElementById('radar-workspace').children);
        apply(session.settings);
        if (session.scopeOptions) applyScopeControls(session.scopeOptions);
        if (session.stage) session.stage('Loading simulator assets');
        return new App($('body'), airport); // Controller instances belong to this browsing context.
    } catch (error) { session.fail(error); }
}
