import RadarBackdrop from './RadarBackdrop';
import MenuVisualController from './MenuVisualController';
import AirportGlobe from './AirportGlobe';

/**
 * Mount Menu V2 decorative radar and presentation enhancements onto #session-menu.
 * @param {HTMLDialogElement} [menuEl]
 * @returns {MenuVisualController|null}
 */
export function mountMenuVisuals(menuEl = document.getElementById('session-menu')) {
    if (!menuEl) return null;
    return new MenuVisualController(menuEl);
}

export { RadarBackdrop, MenuVisualController, AirportGlobe };
