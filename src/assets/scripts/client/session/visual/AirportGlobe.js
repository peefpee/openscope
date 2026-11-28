import { WORLD_COASTLINES } from './worldCoastlines';

const DEG_TO_RAD = Math.PI / 180;
const AUSTRALIA_VIEW = { lat: -25.5, lon: 134.5, zoom: 2.35 };

function latLonToVec3(latDeg, lonDeg, radius = 1) {
    const lat = latDeg * DEG_TO_RAD;
    const lon = lonDeg * DEG_TO_RAD;
    const cosLat = Math.cos(lat);
    return [
        radius * cosLat * Math.sin(lon),
        radius * Math.sin(lat),
        radius * cosLat * Math.cos(lon)
    ];
}

function createMat4Identity() {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);
}

function multiplyMat4(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c += 1) {
        for (let r = 0; r < 4; r += 1) {
            out[c * 4 + r] =
                a[r] * b[c * 4] +
                a[4 + r] * b[c * 4 + 1] +
                a[8 + r] * b[c * 4 + 2] +
                a[12 + r] * b[c * 4 + 3];
        }
    }
    return out;
}

function perspectiveMat4(fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0
    ]);
}

function rotationXMat4(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return new Float32Array([
        1, 0, 0, 0,
        0, c, s, 0,
        0, -s, c, 0,
        0, 0, 0, 1
    ]);
}

function rotationYMat4(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return new Float32Array([
        c, 0, -s, 0,
        0, 1, 0, 0,
        s, 0, c, 0,
        0, 0, 0, 1
    ]);
}

function translationMat4(x, y, z) {
    const m = createMat4Identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
}

function buildSphereGeometry(latBands = 40, lonBands = 64) {
    const positions = [];
    const indices = [];

    for (let lat = 0; lat <= latBands; lat += 1) {
        const theta = (lat * Math.PI) / latBands;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        for (let lon = 0; lon <= lonBands; lon += 1) {
            const phi = (lon * 2 * Math.PI) / lonBands;
            const x = sinTheta * Math.sin(phi);
            const y = cosTheta;
            const z = sinTheta * Math.cos(phi);
            positions.push(x, y, z);
        }
    }

    for (let lat = 0; lat < latBands; lat += 1) {
        for (let lon = 0; lon < lonBands; lon += 1) {
            const first = lat * (lonBands + 1) + lon;
            const second = first + lonBands + 1;
            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
        }
    }

    return {
        positions: new Float32Array(positions),
        indices: new Uint16Array(indices)
    };
}

function buildGraticuleVertices() {
    const verts = [];
    for (let lat = -60; lat <= 60; lat += 30) {
        for (let lon = -180; lon < 180; lon += 6) {
            const p1 = latLonToVec3(lat, lon, 1.003);
            const p2 = latLonToVec3(lat, lon + 6, 1.003);
            verts.push(...p1, ...p2);
        }
    }
    for (let lon = -180; lon < 180; lon += 30) {
        for (let lat = -84; lat < 84; lat += 6) {
            const p1 = latLonToVec3(lat, lon, 1.003);
            const p2 = latLonToVec3(lat + 6, lon, 1.003);
            verts.push(...p1, ...p2);
        }
    }
    return new Float32Array(verts);
}

function buildCoastlineVertices() {
    const verts = [];
    WORLD_COASTLINES.forEach((line) => {
        for (let i = 0; i < line.length - 1; i += 1) {
            const p1 = latLonToVec3(line[i][0], line[i][1], 1.006);
            const p2 = latLonToVec3(line[i + 1][0], line[i + 1][1], 1.006);
            verts.push(...p1, ...p2);
        }
    });
    return new Float32Array(verts);
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vsSource, fsSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteProgram(prog);
        return null;
    }
    return prog;
}

const SPHERE_VS = `
attribute vec3 aPosition;
uniform mat4 uModelView;
uniform mat4 uProjection;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
    vec4 mvPos = uModelView * vec4(aPosition, 1.0);
    vNormal = normalize((uModelView * vec4(aPosition, 0.0)).xyz);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = uProjection * mvPos;
}
`;

const SPHERE_FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
    float ndotv = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    float rim = pow(1.0 - ndotv, 3.0);
    vec3 ocean = mix(vec3(0.020, 0.055, 0.075), vec3(0.047, 0.118, 0.145), ndotv);
    vec3 glow = vec3(0.561, 0.776, 0.827) * rim * 0.42;
    gl_FragColor = vec4(ocean + glow, 1.0);
}
`;

const LINE_VS = `
attribute vec3 aPosition;
uniform mat4 uModelView;
uniform mat4 uProjection;
varying float vFacing;
void main() {
    vec4 mvPos = uModelView * vec4(aPosition, 1.0);
    vec3 normal = normalize((uModelView * vec4(aPosition, 0.0)).xyz);
    vFacing = dot(normal, normalize(-mvPos.xyz));
    gl_Position = uProjection * mvPos;
}
`;

const LINE_FS = `
precision mediump float;
uniform vec4 uColor;
varying float vFacing;
void main() {
    if (vFacing < -0.02) discard;
    float fade = smoothstep(-0.02, 0.25, vFacing);
    gl_FragColor = vec4(uColor.rgb, uColor.a * fade);
}
`;

/**
 * Interactive 3D WebGL Airport Globe with accessible marker overlay and
 * automatic 2D list fallback when WebGL is unavailable.
 */
export default class AirportGlobe {
    /**
     * @param {HTMLElement} container
     * @param {Object} [options]
     * @param {Function} [options.onSelect]
     */
    constructor(container, options = {}) {
        this.container = container;
        this.onSelect = options.onSelect || (() => {});
        this.canvas = container ? container.querySelector('.globe-canvas') : null;
        this.markerLayer = container ? container.querySelector('.globe-markers') : null;

        this.airports = [];
        this.selectedIcao = '';
        this.lat = AUSTRALIA_VIEW.lat;
        this.lon = AUSTRALIA_VIEW.lon;
        this.zoom = AUSTRALIA_VIEW.zoom;
        this.targetView = null;

        this.width = 640;
        this.height = 420;
        this.active = false;
        this.destroyed = false;
        this.rafId = null;
        this.dragging = false;
        this.dragMoved = false;
        this.lastPointer = null;
        this.pinchDistance = null;
        this.markerNodes = new Map();
        this.webglReady = false;

        this.motionQuery = typeof window.matchMedia === 'function' ?
            window.matchMedia('(prefers-reduced-motion: reduce)') :
            null;
        this.reducedMotion = Boolean(this.motionQuery && this.motionQuery.matches);

        this._bindEvents();
        this._initWebGL();
        this.resize();
    }

    _bindEvents() {
        this._onPointerDown = (e) => {
            if (e.target.closest('button')) return;
            this.dragging = true;
            this.dragMoved = false;
            this.targetView = null;
            this.downPointer = { x: e.clientX, y: e.clientY };
            this.lastPointer = { x: e.clientX, y: e.clientY };
        };
        this._onPointerMove = (e) => {
            if (!this.dragging || !this.lastPointer) return;
            const dx = e.clientX - this.lastPointer.x;
            const dy = e.clientY - this.lastPointer.y;
            if (this.downPointer &&
                (Math.abs(e.clientX - this.downPointer.x) > 5 || Math.abs(e.clientY - this.downPointer.y) > 5)) {
                this.dragMoved = true;
            }
            this.lastPointer = { x: e.clientX, y: e.clientY };
            const sensitivity = 0.24 / Math.max(0.8, this.zoom * 0.55);
            this.lon -= dx * sensitivity;
            this.lat = Math.max(-80, Math.min(80, this.lat + dy * sensitivity));
            this._scheduleRender();
        };
        this._onPointerUp = () => {
            this.dragging = false;
            this.lastPointer = null;
            this.downPointer = null;
            setTimeout(() => {
                this.dragMoved = false;
            }, 0);
        };
        this._onWheel = (e) => {
            e.preventDefault();
            this.targetView = null;
            const factor = e.deltaY > 0 ? 0.92 : 1.08;
            this.zoom = Math.max(1.15, Math.min(5.2, this.zoom * factor));
            this._scheduleRender();
        };
        this._onTouchStart = (e) => {
            if (e.touches.length === 2) {
                this.pinchDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        };
        this._onTouchMove = (e) => {
            if (e.touches.length === 2 && this.pinchDistance) {
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                const factor = dist / this.pinchDistance;
                this.pinchDistance = dist;
                this.zoom = Math.max(1.15, Math.min(5.2, this.zoom * factor));
                this._scheduleRender();
            }
        };
        this._onTouchEnd = () => {
            this.pinchDistance = null;
        };
        this._onVisibility = () => {
            if (document.hidden) this._cancelRaf();
            else if (this.active) this._scheduleRender();
        };
        this._onResize = () => this.resize();
        this._onContextLost = (e) => {
            e.preventDefault();
            this._setFallback(true);
        };
        this._onContextRestored = () => {
            this._initWebGL();
            if (this.webglReady) this._setFallback(false);
        };

        if (this.container) {
            this.container.addEventListener('pointerdown', this._onPointerDown);
            this.container.addEventListener('wheel', this._onWheel, { passive: false });
            this.container.addEventListener('touchstart', this._onTouchStart, { passive: true });
            this.container.addEventListener('touchmove', this._onTouchMove, { passive: true });
            this.container.addEventListener('touchend', this._onTouchEnd);
        }
        window.addEventListener('pointermove', this._onPointerMove);
        window.addEventListener('pointerup', this._onPointerUp);
        window.addEventListener('resize', this._onResize);
        document.addEventListener('visibilitychange', this._onVisibility);
        if (this.canvas) {
            this.canvas.addEventListener('webglcontextlost', this._onContextLost);
            this.canvas.addEventListener('webglcontextrestored', this._onContextRestored);
        }
        if (typeof ResizeObserver === 'function' && this.container) {
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.container);
        }
    }

    _initWebGL() {
        if (!this.canvas) {
            this._setFallback(true);
            return;
        }
        let gl = null;
        try {
            gl = this.canvas.getContext('webgl', { antialias: true, alpha: true }) ||
                this.canvas.getContext('experimental-webgl', { antialias: true, alpha: true });
        } catch (e) {
            gl = null;
        }
        if (!gl) {
            this.gl = null;
            this.webglReady = false;
            this._setFallback(true);
            return;
        }

        const sphereProg = createProgram(gl, SPHERE_VS, SPHERE_FS);
        const lineProg = createProgram(gl, LINE_VS, LINE_FS);
        if (!sphereProg || !lineProg) {
            this.gl = null;
            this.webglReady = false;
            this._setFallback(true);
            return;
        }

        const sphere = buildSphereGeometry();
        const grat = buildGraticuleVertices();
        const coast = buildCoastlineVertices();

        const makeBuffer = (target, data) => {
            const buf = gl.createBuffer();
            gl.bindBuffer(target, buf);
            gl.bufferData(target, data, gl.STATIC_DRAW);
            return buf;
        };

        this.gl = gl;
        this.glResources = {
            sphereProg,
            lineProg,
            sphereVbo: makeBuffer(gl.ARRAY_BUFFER, sphere.positions),
            sphereIbo: makeBuffer(gl.ELEMENT_ARRAY_BUFFER, sphere.indices),
            sphereIndexCount: sphere.indices.length,
            gratVbo: makeBuffer(gl.ARRAY_BUFFER, grat),
            gratVertexCount: grat.length / 3,
            coastVbo: makeBuffer(gl.ARRAY_BUFFER, coast),
            coastVertexCount: coast.length / 3
        };
        this.webglReady = true;
        this._setFallback(false);
    }

    _setFallback(isFallback) {
        if (this.container) {
            this.container.classList.toggle('is-fallback', Boolean(isFallback));
        }
    }

    setAirports(airports = [], selectedIcao = '') {
        this.airports = Array.isArray(airports) ? airports : [];
        this.selectedIcao = selectedIcao ? selectedIcao.toUpperCase() : '';
        this._rebuildMarkers();
        this._scheduleRender();
    }

    setSelected(icao, animate = false) {
        this.selectedIcao = icao ? icao.toUpperCase() : '';
        this.markerNodes.forEach((node, key) => {
            const selected = key === this.selectedIcao;
            node.classList.toggle('is-selected', selected);
            node.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        if (animate) {
            const entry = this.airports.find((a) => a.icao === this.selectedIcao);
            if (entry && Array.isArray(entry.coordinates)) {
                this.focusCoordinates(entry.coordinates[0], entry.coordinates[1]);
            }
        }
        this._scheduleRender();
    }

    focusCoordinates(lat, lon, zoom = Math.max(this.zoom, 2.8)) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (this.reducedMotion || !this.active) {
            this.lat = lat;
            this.lon = lon;
            this.zoom = zoom;
            this.targetView = null;
            this._scheduleRender();
            return;
        }
        this.targetView = { lat, lon, zoom };
        this._scheduleRender();
    }

    resetView() {
        this.focusCoordinates(AUSTRALIA_VIEW.lat, AUSTRALIA_VIEW.lon, AUSTRALIA_VIEW.zoom);
    }

    setActive(active) {
        this.active = Boolean(active);
        if (this.active) {
            this.resize();
            this._scheduleRender();
        } else {
            this._cancelRaf();
        }
    }

    resize() {
        if (!this.container) return;
        const rect = this.container.getBoundingClientRect();
        this.width = Math.max(240, rect.width || 640);
        this.height = Math.max(220, rect.height || 420);
        if (this.canvas && this.gl) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            this.canvas.width = Math.round(this.width * dpr);
            this.canvas.height = Math.round(this.height * dpr);
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
        if (this.active) this._scheduleRender();
    }

    _rebuildMarkers() {
        if (!this.markerLayer) return;
        while (this.markerLayer.firstChild) {
            this.markerLayer.removeChild(this.markerLayer.firstChild);
        }
        this.markerNodes.clear();

        this.airports.forEach((entry) => {
            if (!entry || !Array.isArray(entry.coordinates)) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `globe-marker globe-marker--${entry.sourceType || 'bundled'}`;
            if (entry.icao === this.selectedIcao) btn.classList.add('is-selected');
            btn.dataset.icao = entry.icao;
            btn.setAttribute('aria-label', `${entry.icao} ${entry.name} (${entry.sourceType})`);
            btn.setAttribute('aria-pressed', entry.icao === this.selectedIcao ? 'true' : 'false');

            const dot = document.createElement('span');
            dot.className = 'globe-marker__dot';
            const label = document.createElement('span');
            label.className = 'globe-marker__label';
            label.textContent = entry.icao;
            btn.append(dot, label);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.dragging && this.dragMoved) return;
                this.targetView = null;
                this.onSelect(entry.icao);
            });

            this.markerLayer.append(btn);
            this.markerNodes.set(entry.icao, btn);
        });
    }

    _scheduleRender() {
        if (this.destroyed || !this.active || document.hidden || this.rafId !== null) return;
        this.rafId = window.requestAnimationFrame(() => {
            this.rafId = null;
            if (!this.active || this.destroyed || document.hidden) return;
            const animating = this._stepAnimation();
            this.render();
            if (animating) this._scheduleRender();
        });
    }

    _cancelRaf() {
        if (this.rafId !== null) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    _stepAnimation() {
        if (!this.targetView) return false;
        const dLat = this.targetView.lat - this.lat;
        const dLon = ((this.targetView.lon - this.lon + 540) % 360) - 180;
        const dZoom = this.targetView.zoom - this.zoom;
        if (Math.abs(dLat) < 0.08 && Math.abs(dLon) < 0.08 && Math.abs(dZoom) < 0.01) {
            this.lat = this.targetView.lat;
            this.lon = this.targetView.lon;
            this.zoom = this.targetView.zoom;
            this.targetView = null;
            return false;
        }
        this.lat += dLat * 0.18;
        this.lon += dLon * 0.18;
        this.zoom += dZoom * 0.18;
        return true;
    }

    _cameraMatrices() {
        const aspect = this.width / Math.max(1, this.height);
        const proj = perspectiveMat4(38 * DEG_TO_RAD, aspect, 0.1, 20);
        const dist = 4.2 / this.zoom + 1.05;
        const view = translationMat4(0, 0, -dist);
        const rotX = rotationXMat4(this.lat * DEG_TO_RAD);
        const rotY = rotationYMat4(-this.lon * DEG_TO_RAD);
        const modelView = multiplyMat4(view, multiplyMat4(rotX, rotY));
        return { proj, modelView };
    }

    render() {
        const { proj, modelView } = this._cameraMatrices();

        if (this.gl && this.glResources && this.webglReady) {
            const { gl, glResources } = this;
            gl.clearColor(0, 0, 0, 0);
            // eslint-disable-next-line no-bitwise
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

            // Draw ocean sphere
            gl.useProgram(glResources.sphereProg);
            gl.uniformMatrix4fv(gl.getUniformLocation(glResources.sphereProg, 'uModelView'), false, modelView);
            gl.uniformMatrix4fv(gl.getUniformLocation(glResources.sphereProg, 'uProjection'), false, proj);
            gl.bindBuffer(gl.ARRAY_BUFFER, glResources.sphereVbo);
            const sAttr = gl.getAttribLocation(glResources.sphereProg, 'aPosition');
            gl.enableVertexAttribArray(sAttr);
            gl.vertexAttribPointer(sAttr, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glResources.sphereIbo);
            gl.drawElements(gl.TRIANGLES, glResources.sphereIndexCount, gl.UNSIGNED_SHORT, 0);

            // Draw graticule and coastlines
            gl.useProgram(glResources.lineProg);
            gl.uniformMatrix4fv(gl.getUniformLocation(glResources.lineProg, 'uModelView'), false, modelView);
            gl.uniformMatrix4fv(gl.getUniformLocation(glResources.lineProg, 'uProjection'), false, proj);
            const lAttr = gl.getAttribLocation(glResources.lineProg, 'aPosition');
            const colorLoc = gl.getUniformLocation(glResources.lineProg, 'uColor');

            gl.bindBuffer(gl.ARRAY_BUFFER, glResources.gratVbo);
            gl.enableVertexAttribArray(lAttr);
            gl.vertexAttribPointer(lAttr, 3, gl.FLOAT, false, 0, 0);
            gl.uniform4f(colorLoc, 0.561, 0.776, 0.827, 0.11);
            gl.drawArrays(gl.LINES, 0, glResources.gratVertexCount);

            gl.bindBuffer(gl.ARRAY_BUFFER, glResources.coastVbo);
            gl.vertexAttribPointer(lAttr, 3, gl.FLOAT, false, 0, 0);
            gl.uniform4f(colorLoc, 0.569, 0.910, 0.737, 0.42);
            gl.drawArrays(gl.LINES, 0, glResources.coastVertexCount);
        }

        this._projectMarkers(proj, modelView);
    }

    _projectMarkers(proj, modelView) {
        if (!this.markerLayer) return;
        const placedLabels = [];
        const entries = [...this.airports].sort((a, b) => {
            if (a.icao === this.selectedIcao) return -1;
            if (b.icao === this.selectedIcao) return 1;
            return 0;
        });

        entries.forEach((entry) => {
            const node = this.markerNodes.get(entry.icao);
            if (!node || !Array.isArray(entry.coordinates)) return;
            const [lat, lon] = entry.coordinates;
            const [vx, vy, vz] = latLonToVec3(lat, lon, 1.012);

            const cx = modelView[0] * vx + modelView[4] * vy + modelView[8] * vz + modelView[12];
            const cy = modelView[1] * vx + modelView[5] * vy + modelView[9] * vz + modelView[13];
            const cz = modelView[2] * vx + modelView[6] * vy + modelView[10] * vz + modelView[14];

            // Normal in view space (sphere centred at origin)
            const nx = modelView[0] * vx + modelView[4] * vy + modelView[8] * vz;
            const ny = modelView[1] * vx + modelView[5] * vy + modelView[9] * vz;
            const nz = modelView[2] * vx + modelView[6] * vy + modelView[10] * vz;
            const facing = -(nx * cx + ny * cy + nz * cz);

            if (facing <= 0.08) {
                node.hidden = true;
                return;
            }

            const clipX = proj[0] * cx + proj[4] * cy + proj[8] * cz + proj[12];
            const clipY = proj[1] * cx + proj[5] * cy + proj[9] * cz + proj[13];
            const clipW = proj[3] * cx + proj[7] * cy + proj[11] * cz + proj[15];
            if (clipW <= 0) {
                node.hidden = true;
                return;
            }

            const sx = ((clipX / clipW) * 0.5 + 0.5) * this.width;
            const sy = (0.5 - (clipY / clipW) * 0.5) * this.height;
            if (sx < -20 || sx > this.width + 20 || sy < -20 || sy > this.height + 20) {
                node.hidden = true;
                return;
            }

            node.hidden = false;
            node.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;

            const labelEl = node.querySelector('.globe-marker__label');
            if (labelEl) {
                const overlaps = entry.icao !== this.selectedIcao &&
                    placedLabels.some(([px, py]) => Math.abs(px - sx) < 42 && Math.abs(py - sy) < 18);
                labelEl.hidden = overlaps;
                if (!overlaps) placedLabels.push([sx, sy]);
            }
        });
    }

    destroy() {
        this.destroyed = true;
        this.active = false;
        this._cancelRaf();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.container) {
            this.container.removeEventListener('pointerdown', this._onPointerDown);
            this.container.removeEventListener('wheel', this._onWheel);
            this.container.removeEventListener('touchstart', this._onTouchStart);
            this.container.removeEventListener('touchmove', this._onTouchMove);
            this.container.removeEventListener('touchend', this._onTouchEnd);
        }
        window.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('pointerup', this._onPointerUp);
        window.removeEventListener('resize', this._onResize);
        document.removeEventListener('visibilitychange', this._onVisibility);
        if (this.canvas) {
            this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
            this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
        }
        if (this.gl && this.glResources) {
            const { gl, glResources } = this;
            gl.deleteBuffer(glResources.sphereVbo);
            gl.deleteBuffer(glResources.sphereIbo);
            gl.deleteBuffer(glResources.gratVbo);
            gl.deleteBuffer(glResources.coastVbo);
            gl.deleteProgram(glResources.sphereProg);
            gl.deleteProgram(glResources.lineProg);
            this.glResources = null;
        }
        this.markerNodes.clear();
    }
}
