const TARGET_SPECS = [
    {
        callsign: 'QFA412', alt: 'A090', spd: '250', r: 0.34, angle: 0.4, speed: 0.018, heading: 2.1
    },
    {
        callsign: 'JST508', alt: 'A065', spd: '220', r: 0.24, angle: 1.9, speed: 0.022, heading: 3.5
    },
    {
        callsign: 'VOZ814', alt: 'F140', spd: '280', r: 0.48, angle: 3.2, speed: 0.014, heading: 4.9
    },
    {
        callsign: 'RXA122', alt: 'A045', spd: '185', r: 0.18, angle: 4.6, speed: 0.026, heading: 0.3
    },
    {
        callsign: 'QFA921', alt: 'F180', spd: '310', r: 0.58, angle: 5.5, speed: 0.012, heading: 1.1
    },
    {
        callsign: 'VOZ302', alt: 'A110', spd: '240', r: 0.41, angle: 2.6, speed: 0.017, heading: 5.7
    }
];

const COAST_CONTOUR = [
    [0.54, 0.06], [0.58, 0.18], [0.64, 0.26], [0.62, 0.38],
    [0.68, 0.49], [0.65, 0.62], [0.58, 0.76], [0.53, 0.92]
];

const AIRSPACE_BOUNDARY = [
    [0.42, 0.16], [0.76, 0.14], [0.92, 0.36],
    [0.88, 0.72], [0.64, 0.86], [0.40, 0.68], [0.36, 0.38]
];

/**
 * Lightweight standalone decorative radar background for the main menu.
 * Independent of the simulation engine and GameController.
 */
export default class RadarBackdrop {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;
        this.rafId = null;
        this.running = false;
        this.destroyed = false;
        this.lastTime = 0;
        this.sweepAngle = -Math.PI / 3;
        this.width = 0;
        this.height = 0;
        this.dpr = 1;
        this.targets = TARGET_SPECS.map((spec) => ({
            ...spec,
            x: 0,
            y: 0,
            trail: []
        }));

        this.motionQuery = typeof window.matchMedia === 'function' ?
            window.matchMedia('(prefers-reduced-motion: reduce)') :
            null;
        this.reducedMotion = Boolean(this.motionQuery && this.motionQuery.matches);

        this._onResize = () => this.resize();
        this._onVisibilityChange = () => this._handleVisibility();
        this._onMotionChange = (event) => {
            this.reducedMotion = Boolean(event.matches);
            if (this.reducedMotion) {
                this._cancelFrame();
                this.renderFrame(0);
            } else if (this.running && !document.hidden) {
                this._scheduleFrame();
            }
        };

        window.addEventListener('resize', this._onResize);
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        if (this.motionQuery && typeof this.motionQuery.addEventListener === 'function') {
            this.motionQuery.addEventListener('change', this._onMotionChange);
        }

        this.resize();
    }

    /**
     * Resize canvas backing store with devicePixelRatio support.
     */
    resize() {
        if (!this.canvas || !this.ctx) return;
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width || window.innerWidth || 1280);
        const height = Math.max(1, rect.height || window.innerHeight || 720);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        this.width = width;
        this.height = height;
        this.dpr = dpr;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._seedTargets();
        this.renderFrame(0);
    }

    /**
     * Start the decorative radar animation loop.
     */
    start() {
        if (this.destroyed || !this.ctx) return;
        this.running = true;
        this.canvas.classList.add('is-active');
        this.lastTime = 0;

        if (this.reducedMotion || document.hidden) {
            this.renderFrame(0);
            return;
        }
        this._scheduleFrame();
    }

    /**
     * Stop animation without removing listeners (used when entering gameplay).
     */
    stop() {
        this.running = false;
        this._cancelFrame();
        if (this.canvas) {
            this.canvas.classList.remove('is-active');
        }
    }

    /**
     * Clean up all animation frames and event listeners.
     */
    destroy() {
        this.stop();
        this.destroyed = true;
        window.removeEventListener('resize', this._onResize);
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        if (this.motionQuery && typeof this.motionQuery.removeEventListener === 'function') {
            this.motionQuery.removeEventListener('change', this._onMotionChange);
        }
    }

    _handleVisibility() {
        if (!this.running || this.destroyed) return;
        if (document.hidden) {
            this._cancelFrame();
        } else if (!this.reducedMotion) {
            this.lastTime = 0;
            this._scheduleFrame();
        }
    }

    _scheduleFrame() {
        if (this.rafId !== null || !this.running || this.reducedMotion || document.hidden) return;
        this.rafId = window.requestAnimationFrame((ts) => {
            this.rafId = null;
            if (!this.running || this.destroyed || document.hidden || this.reducedMotion) return;
            const dt = this.lastTime ? Math.min((ts - this.lastTime) / 1000, 0.1) : 0.016;
            this.lastTime = ts;
            this.renderFrame(dt);
            this._scheduleFrame();
        });
    }

    _cancelFrame() {
        if (this.rafId !== null) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    _centre() {
        const isWide = this.width >= 880;
        return {
            cx: isWide ? this.width * 0.72 : this.width * 0.5,
            cy: this.height * 0.5,
            radius: Math.min(this.width, this.height) * 0.44
        };
    }

    _seedTargets() {
        const { cx, cy, radius } = this._centre();
        this.targets.forEach((target) => {
            target.x = cx + Math.cos(target.angle) * radius * target.r;
            target.y = cy + Math.sin(target.angle) * radius * target.r;
            target.trail = [];
            for (let i = 4; i >= 1; i -= 1) {
                target.trail.push({
                    x: target.x - Math.cos(target.heading) * i * 7,
                    y: target.y - Math.sin(target.heading) * i * 7
                });
            }
        });
    }

    /**
     * Advance state by dt seconds and paint one radar frame.
     * @param {number} dt
     */
    renderFrame(dt) {
        const { ctx, width, height } = this;
        if (!ctx || !width || !height) return;

        ctx.clearRect(0, 0, width, height);
        const { cx, cy, radius } = this._centre();

        this._drawGeography(ctx, width, height);
        this._drawAirspace(ctx, width, height);
        this._drawRangeRings(ctx, cx, cy, radius);
        this._drawRunways(ctx, cx, cy);

        if (dt > 0) {
            this.sweepAngle = (this.sweepAngle + dt * 0.36) % (Math.PI * 2);
            this._updateTargets(dt, cx, cy, radius);
        }

        this._drawSweep(ctx, cx, cy, radius);
        this._drawTargets(ctx);
    }

    _drawGeography(ctx, width, height) {
        ctx.save();
        ctx.beginPath();
        COAST_CONTOUR.forEach(([nx, ny], idx) => {
            const x = nx * width;
            const y = ny * height;
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = 'rgba(143, 198, 211, 0.08)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    _drawAirspace(ctx, width, height) {
        ctx.save();
        ctx.beginPath();
        AIRSPACE_BOUNDARY.forEach(([nx, ny], idx) => {
            const x = nx * width;
            const y = ny * height;
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(143, 198, 211, 0.14)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    _drawRangeRings(ctx, cx, cy, radius) {
        ctx.save();
        const rings = [0.25, 0.5, 0.75, 1];
        rings.forEach((factor, index) => {
            ctx.beginPath();
            ctx.arc(cx, cy, radius * factor, 0, Math.PI * 2);
            ctx.strokeStyle = index === rings.length - 1 ?
                'rgba(143, 198, 211, 0.18)' :
                'rgba(143, 198, 211, 0.1)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        ctx.strokeStyle = 'rgba(143, 198, 211, 0.08)';
        ctx.beginPath();
        ctx.moveTo(cx - radius, cy);
        ctx.lineTo(cx + radius, cy);
        ctx.moveTo(cx, cy - radius);
        ctx.lineTo(cx, cy + radius);
        ctx.stroke();
        ctx.restore();
    }

    _drawRunways(ctx, cx, cy) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.strokeStyle = 'rgba(145, 232, 188, 0.35)';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-18, -22);
        ctx.lineTo(14, 24);
        ctx.moveTo(-8, -26);
        ctx.lineTo(24, 20);
        ctx.moveTo(-26, 8);
        ctx.lineTo(22, -10);
        ctx.stroke();
        ctx.restore();
    }

    _drawSweep(ctx, cx, cy, radius) {
        ctx.save();
        const span = 0.52;
        const steps = 12;
        for (let i = 0; i < steps; i += 1) {
            const a0 = this.sweepAngle - (span * (i + 1)) / steps;
            const a1 = this.sweepAngle - (span * i) / steps;
            const alpha = (1 - i / steps) * 0.08;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, a0, a1);
            ctx.closePath();
            ctx.fillStyle = `rgba(145, 232, 188, ${alpha.toFixed(4)})`;
            ctx.fill();
        }

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(this.sweepAngle) * radius, cy + Math.sin(this.sweepAngle) * radius);
        ctx.strokeStyle = 'rgba(145, 232, 188, 0.32)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
    }

    _updateTargets(dt, cx, cy, radius) {
        const pxPerSec = 14;
        this.targets.forEach((target) => {
            target.x += Math.cos(target.heading) * pxPerSec * target.speed * 50 * dt;
            target.y += Math.sin(target.heading) * pxPerSec * target.speed * 50 * dt;

            const dx = target.x - cx;
            const dy = target.y - cy;
            if (Math.hypot(dx, dy) > radius * 0.96) {
                target.heading = Math.atan2(-dy, -dx) + (Math.random() - 0.5) * 0.4;
            }

            if (!target.trail.length || Math.hypot(
                target.x - target.trail[target.trail.length - 1].x,
                target.y - target.trail[target.trail.length - 1].y
            ) > 7) {
                target.trail.push({ x: target.x, y: target.y });
                if (target.trail.length > 6) target.trail.shift();
            }
        });
    }

    _drawTargets(ctx) {
        ctx.save();
        ctx.font = '10px monoOne, ui-monospace, monospace';
        this.targets.forEach((target) => {
            target.trail.forEach((pt, idx) => {
                const alpha = ((idx + 1) / (target.trail.length + 1)) * 0.38;
                ctx.fillStyle = `rgba(145, 232, 188, ${alpha.toFixed(3)})`;
                ctx.fillRect(pt.x - 1, pt.y - 1, 2, 2);
            });

            ctx.strokeStyle = 'rgba(145, 232, 188, 0.85)';
            ctx.lineWidth = 1.3;
            ctx.strokeRect(target.x - 3, target.y - 3, 6, 6);

            ctx.beginPath();
            ctx.moveTo(target.x, target.y);
            ctx.lineTo(
                target.x + Math.cos(target.heading) * 14,
                target.y + Math.sin(target.heading) * 14
            );
            ctx.strokeStyle = 'rgba(143, 198, 211, 0.55)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = 'rgba(240, 248, 247, 0.82)';
            ctx.fillText(target.callsign, target.x + 9, target.y - 2);
            ctx.fillStyle = 'rgba(143, 198, 211, 0.72)';
            ctx.fillText(`${target.alt} ${target.spd}`, target.x + 9, target.y + 9);
        });
        ctx.restore();
    }
}
