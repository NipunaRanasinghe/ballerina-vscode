/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { useEffect, useRef } from "react";

/**
 * Siri-style orb rendered with a WebGL fragment shader: domain-warped fbm
 * noise color fields inside a circular mask. State changes are conveyed by
 * lerping color/energy uniforms each frame, so transitions crossfade
 * continuously instead of snapping.
 *
 * - `energy` scales flow speed and contrast (idle ≈ calm, running ≈ lively).
 * - Honors `prefers-reduced-motion`: renders a single static frame instead
 *   of animating.
 * - Calls `onContextFailed` if a WebGL context can't be created so the parent
 *   can fall back to the CSS orb.
 */

interface ShaderOrbProps {
    colors: [string, string, string];
    energy: number;
    size: number;
    onContextFailed: () => void;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
    const value = parseInt(hex.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * How much wider the canvas is than the orb itself. The shader draws the sphere
 * at SPHERE_R of the canvas and spends the remaining margin on the glow around
 * it; the two constants are reciprocal and must stay in step.
 */
const ORB_CANVAS_SCALE = 1.22;

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
    v_uv = a_pos;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_energy;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.02;
        a *= 0.5;
    }
    return v;
}

// The light rig, measured off the product's reference render rather than tuned
// by eye. Two lights 60 degrees apart orbit clockwise at 0.678 rad/s (a 9.3s
// revolution); each reflects off both walls of the shell, so there are four
// arcs. Arcs peak at r = 0.85 and each is a broad tinted halo plus a sharp
// core: one gaussian cannot be both bright enough to clip at its centre and
// wide enough in the shoulders, which is what left earlier versions looking
// washed out rather than lit.
const float SPHERE_R = 0.8197;
const float SPIN = 0.678;
const float LIGHT_SEP = 1.0472;
const float LIGHT_Z = -0.4304;
const float LOBE_RADIAL = 0.2502;
const float LOBE_AZIMUTH = 0.2339;
const float CORE_RADIAL = 0.0060;
const float CORE_AZIMUTH = 0.2189;
const float CORE_I = 1.1092;
const float WARM_I = 1.1500;
const float COOL_I = 0.6862;
const float FAR_WALL = 0.6997;
const float FRESNEL_EXP = 4.0000;
const float BASE_FLAT = 0.8000;
const float BASE_NOISE = 0.3766;
const float BASE_FRESNEL = 1.0000;
const float AMBIENT_I = 0.2200;
const float FILM_LO = 0.9549;
const float FILM_HI = 0.99;
const float FILM_I = 0.0400;
const float BLOOM_I = 0.2494;
const float BLOOM_WIDTH = 0.0619;
const float FEATHER = 0.02;
const float PI = 3.14159265;

/** Angular falloff of one arc about its bearing. */
float lobe(float az, float bearing, float width) {
    float d = abs(mod(az - bearing + PI, 2.0 * PI) - PI);
    return exp(-d * d / width);
}

/** One arc: the broad tinted halo plus the sharp core that clips to white. */
float arc(float az, float bearing, float halo, float core) {
    return halo * lobe(az, bearing, LOBE_AZIMUTH)
         + core * lobe(az, bearing, CORE_AZIMUTH) * CORE_I;
}

void main() {
    // The sphere occupies SPHERE_R of the canvas; the remaining margin is where
    // the glow outside the silhouette is drawn. Measured off the reference, that
    // glow still carries ~13% of peak brightness a whole radius-tenth out, so a
    // canvas cropped to the silhouette cannot show it at all.
    vec2 uv = v_uv / SPHERE_R;
    float r = length(uv);
    float t = u_time * (0.18 + 0.55 * u_energy);

    // Domain warp: two fbm fields displace a third for the liquid look.
    vec2 q = vec2(
        fbm(uv * 1.6 + vec2(t * 0.7, -t * 0.5)),
        fbm(uv * 1.6 + vec2(-t * 0.6, t * 0.8))
    );
    float warpStrength = 1.4 + 1.2 * u_energy;
    float f = fbm(uv * 2.2 + warpStrength * q + vec2(t * 0.3, -t * 0.2));

    // Shade this as a hollow sphere rather than painting rings onto a disc.
    // rc clamps to the silhouette so the margin keeps the edge's values.
    float rc = min(r, 1.0);
    float z = sqrt(max(0.0, 1.0 - rc * rc));

    // A light reflects off the surface where the reflection vector matches its
    // direction. For a sphere seen head-on that reduces to Rz = 1 - 2r^2, so a
    // light's elevation alone fixes the radius its highlight lands at. The
    // reference's arcs peak at r = 0.85, hence LIGHT_Z = 1 - 2*0.85^2.
    float Rz = 1.0 - 2.0 * rc * rc;
    float fres = pow(1.0 - z, FRESNEL_EXP);

    // What shows through the film: the dark backdrop behind the bubble.
    vec3 col = u_c0 * (BASE_FLAT + BASE_NOISE * f) * (1.0 - BASE_FRESNEL * fres);

    // Ambient reflected off the film. Fresnel makes the shell more mirror-like
    // at grazing angles, so this lifts the whole rim including the gaps between
    // the arcs — in the reference those gaps are brighter than the centre, which
    // a body that only darkens outward cannot reproduce.
    col += u_c1 * (AMBIENT_I * fres);

    // Two lights LIGHT_SEP apart orbit the view axis. Each reflects off BOTH
    // walls of the shell: off the near wall at its own bearing, and off the far
    // wall half a turn away, because reflecting off a back-facing normal mirrors
    // the result across the centre. So two lights make four arcs — warm opposite
    // warm, cool opposite cool — which is the pattern the reference shows, its
    // warmth reversing sign four times around the rim.
    float phi = -u_time * SPIN;
    float dE = Rz - LIGHT_Z;
    float halo = exp(-dE * dE / LOBE_RADIAL);
    float core = exp(-dE * dE / CORE_RADIAL);
    float az = atan(uv.y, uv.x);

    vec3 warmC = u_c2 * WARM_I;
    vec3 coolC = u_c1 * COOL_I;
    vec3 arcs = warmC * arc(az, phi, halo, core)
              + coolC * arc(az, phi + LIGHT_SEP, halo, core)
              + warmC * FAR_WALL * arc(az, phi + PI, halo, core)
              + coolC * FAR_WALL * arc(az, phi + LIGHT_SEP + PI, halo, core);
    col += arcs;

    // The soap-film edge: a hairline keeping the silhouette readable through the
    // gaps between the arcs.
    float film = smoothstep(FILM_LO, FILM_HI, r) * (1.0 - smoothstep(FILM_HI, 1.0, r));
    col += mix(u_c1, vec3(1.0), 0.25) * film * FILM_I;

    // Outside the silhouette only the broad halo bleeds into the margin.
    float glow = exp(-max(r - 1.0, 0.0) / BLOOM_WIDTH) * step(1.0, r);
    vec3 glowTint = warmC * lobe(az, phi, LOBE_AZIMUTH)
                  + coolC * lobe(az, phi + LIGHT_SEP, LOBE_AZIMUTH)
                  + warmC * FAR_WALL * lobe(az, phi + PI, LOBE_AZIMUTH)
                  + coolC * FAR_WALL * lobe(az, phi + LIGHT_SEP + PI, LOBE_AZIMUTH);
    col += glowTint * (glow * BLOOM_I);

    float mask = max(1.0 - smoothstep(1.0 - FEATHER, 1.0, r), glow);
    gl_FragColor = vec4(col * mask, mask);
}
`;

function compileProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const compile = (type: number, source: string): WebGLShader | null => {
        const shader = gl.createShader(type);
        if (!shader) {
            return null;
        }
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error("[AgentStatusOrb] shader compile failed:", gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) {
        return null;
    }
    const program = gl.createProgram();
    if (!program) {
        return null;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("[AgentStatusOrb] program link failed:", gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

const LERP_RATE = 4.0;

export function ShaderOrb({ colors, energy, size, onContextFailed }: ShaderOrbProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    /** Target uniform values; the render loop eases toward these. */
    const targetRef = useRef<{ colors: [Rgb, Rgb, Rgb]; energy: number }>({
        colors: [hexToRgb(colors[0]), hexToRgb(colors[1]), hexToRgb(colors[2])],
        energy,
    });
    const failedRef = useRef(false);
    /** Repaints one frame when animation is off (prefers-reduced-motion). */
    const staticRepaintRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        targetRef.current = {
            colors: [hexToRgb(colors[0]), hexToRgb(colors[1]), hexToRgb(colors[2])],
            energy,
        };
        staticRepaintRef.current?.();
    }, [colors[0], colors[1], colors[2], energy]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
        const program = gl ? compileProgram(gl) : null;
        if (!gl || !program) {
            if (!failedRef.current) {
                failedRef.current = true;
                onContextFailed();
            }
            // Program compile failed but the context was created — release it so
            // the fallback path doesn't leak a live WebGL context.
            gl?.getExtension("WEBGL_lose_context")?.loseContext();
            return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = size * ORB_CANVAS_SCALE * dpr;
        canvas.height = size * ORB_CANVAS_SCALE * dpr;
        gl.viewport(0, 0, canvas.width, canvas.height);

        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const posLocation = gl.getAttribLocation(program, "a_pos");
        gl.enableVertexAttribArray(posLocation);
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

        const uTime = gl.getUniformLocation(program, "u_time");
        const uEnergy = gl.getUniformLocation(program, "u_energy");
        const uColors = [
            gl.getUniformLocation(program, "u_c0"),
            gl.getUniformLocation(program, "u_c1"),
            gl.getUniformLocation(program, "u_c2"),
        ];

        gl.clearColor(0, 0, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        const current = {
            colors: targetRef.current.colors.map((c) => [...c] as Rgb) as [Rgb, Rgb, Rgb],
            energy: targetRef.current.energy,
        };

        const draw = (timeSeconds: number) => {
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(uTime, timeSeconds);
            gl.uniform1f(uEnergy, current.energy);
            current.colors.forEach((c, i) => gl.uniform3f(uColors[i], c[0], c[1], c[2]));
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        };

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let rafId = 0;
        let lastMs = performance.now();
        const startMs = lastMs;

        const tick = (nowMs: number) => {
            const dt = Math.min((nowMs - lastMs) / 1000, 0.1);
            lastMs = nowMs;
            // Ease uniforms toward their targets for continuous crossfades.
            const k = 1 - Math.exp(-LERP_RATE * dt);
            const target = targetRef.current;
            current.energy += (target.energy - current.energy) * k;
            for (let i = 0; i < 3; i++) {
                for (let ch = 0; ch < 3; ch++) {
                    current.colors[i][ch] += (target.colors[i][ch] - current.colors[i][ch]) * k;
                }
            }
            draw((nowMs - startMs) / 1000);
            rafId = requestAnimationFrame(tick);
        };

        const renderStatic = () => {
            const target = targetRef.current;
            current.energy = target.energy;
            current.colors = target.colors.map((c) => [...c] as Rgb) as [Rgb, Rgb, Rgb];
            draw(1.7);
        };

        const applyMotionPreference = () => {
            cancelAnimationFrame(rafId);
            if (reducedMotion.matches) {
                renderStatic();
            } else {
                lastMs = performance.now();
                rafId = requestAnimationFrame(tick);
            }
        };

        applyMotionPreference();
        reducedMotion.addEventListener("change", applyMotionPreference);
        staticRepaintRef.current = () => {
            if (reducedMotion.matches) {
                renderStatic();
            }
        };

        return () => {
            cancelAnimationFrame(rafId);
            reducedMotion.removeEventListener("change", applyMotionPreference);
            staticRepaintRef.current = null;
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        };
    }, [size, onContextFailed]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: "absolute",
                // Oversized by ORB_CANVAS_SCALE so the glow outside the
                // silhouette has somewhere to land. The sphere still measures
                // exactly `size` across, so callers and the eye geometry are
                // unaffected. No border-radius: the shader's own alpha draws the
                // silhouette, and clipping to a circle would cut the glow off.
                inset: `${(1 - ORB_CANVAS_SCALE) * 50}%`,
                width: `${ORB_CANVAS_SCALE * 100}%`,
                height: `${ORB_CANVAS_SCALE * 100}%`,
                pointerEvents: "none",
            }}
        />
    );
}
