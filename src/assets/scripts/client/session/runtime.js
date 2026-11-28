import $ from 'jquery';
import { applyScopeControls } from '../ui/ScopeControls';
import App from '../App';
import GameController from '../game/GameController';
import TimeKeeper from '../engine/TimeKeeper';
import navData from '../airport/dat/NavDataCache';
import VoiceController from '../voice/VoiceController';
import VoiceStatusView from '../voice/ui/VoiceStatusView';

export default async function startRadar(session) {
    const bridge = { ...session, suspended: false };
    window.sessionBridge = bridge;
    let voiceController = null;
    let voiceStatusView = null;
    const apply = (settings) => {
        bridge.settings = settings;
        if (window.prop && window.prop.speech) window.prop.speech.enabled = settings.enabled;
        for (const [key, value] of Object.entries(settings.radar)) {
            if (GameController.game.option[key] !== value) GameController.game.option.setOptionByName(key, value);
        }
        if (voiceController && settings.voiceControl) {
            voiceController.configure(settings.voiceControl);
            if (voiceStatusView) voiceStatusView.setEnabled(Boolean(settings.voiceControl.enabled));
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
            if (voiceController) voiceController.setPaused(true);
        },
        resume() {
            cancelSpeech();
            bridge.suspended = false;
            GameController.game_unpause();
            TimeKeeper.setPause(!document.hasFocus());
            if (voiceController) voiceController.setPaused(false);
        },
        stop() {
            bridge.suspended = true;
            cancelSpeech();
            if (voiceController) {
                voiceController.destroy();
                voiceController = null;
            }
            if (voiceStatusView) {
                voiceStatusView.destroy();
                voiceStatusView = null;
            }
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
        const app = new App($('body'), airport); // Controller instances belong to this browsing context.
        voiceController = new VoiceController({
            settings: (session.settings && session.settings.voiceControl) || {},
            aircraftController: app.aircraftController,
            aircraftCommander: app.aircraftCommander,
            onStateChange: (ev) => {
                if (voiceStatusView) voiceStatusView.update(ev);
            }
        });
        voiceStatusView = new VoiceStatusView(document.body, voiceController);
        window.voiceController = voiceController;
        return app;
    } catch (error) { session.fail(error); }
}
