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

void main() {
    vec2 uv = v_uv;
    float r = length(uv);
    float t = u_time * (0.18 + 0.55 * u_energy);

    // Domain warp: two fbm fields displace a third for the liquid look.
    vec2 q = vec2(
        fbm(uv * 1.6 + vec2(t * 0.7, -t * 0.5)),
        fbm(uv * 1.6 + vec2(-t * 0.6, t * 0.8))
    );
    float warpStrength = 1.4 + 1.2 * u_energy;
    float f = fbm(uv * 2.2 + warpStrength * q + vec2(t * 0.3, -t * 0.2));

    // What you see through the bubble: a near-black core with just enough flow
    // that it isn't dead still. Sampling the reference render's radial profile
    // puts the core around 4% luminance all the way out to r 0.72, so nearly
    // everything visible lives in the thin film below — a hollow shell, not a
    // shaded ball.
    vec3 col = u_c0 * (0.5 + 0.3 * f);

    // Hue: a warm pair of streaks and a cool pair 90 degrees apart, each pair
    // opposite itself, the whole set rotating clockwise at ~31 deg/sec (one turn
    // every ~11s). u_time is deliberately raw here, so the hue turns at the same
    // rate in every run state while u_energy drives only the interior flow.
    float a = atan(uv.y, uv.x) + u_time * 0.55 - 1.5708;
    float w = pow(abs(cos(a)), 6.0);
    float c = pow(abs(sin(a)), 6.0);
    // Deliberately NOT mixed toward white. The reference gets its brightness from
    // intense saturated colour (saturation ~0.4 average, ~0.85 at its strongest),
    // and only the small hot cores clip to white — which happens on its own below,
    // where the multiplier drives the dominant channel past 1.0 while the others
    // stay put. Whitening this blend instead flattens the whole shell to pastel
    // grey, which is what made earlier versions read as a matte donut.
    vec3 hue = u_c2 * w + u_c1 * c;

    // Where the light sits is fixed geometry, and it does NOT rotate with the
    // hue. Sampling the reference frame by frame shows the bright features split
    // by height, not by colour: in the upper half they peak at r 0.90-1.00, hard
    // against the silhouette, and in the lower half at r 0.69-0.79, well inset.
    // That pairing — a rim highlight up top, a caustic thrown onto the far wall
    // below — is what reads as a lit hollow sphere. One ring of constant radius
    // cannot, however it is coloured.
    float up = clamp(0.5 + 0.5 * uv.y / max(r, 0.001), 0.0, 1.0);

    // Rim highlight, hard against the silhouette, brightest toward the top. The
    // multiplier is high enough that the core of a streak clips its dominant
    // channel to white while the skirts stay vivid — the reference's bloom.
    float rim = smoothstep(0.86, 0.93, r) * smoothstep(1.0, 0.95, r);
    col += hue * rim * (0.06 + 0.94 * pow(up, 3.0)) * 3.0;

    // Caustic on the far wall, inset, brightest toward the bottom. The gap
    // between this and the rim above is deliberate: in the reference the two
    // sit at 0.81 and 0.95 with a dark trough between them, and without that
    // trough they merge into a single fat band and the depth cue is lost.
    // Both weights fall off steeply with height on purpose. A gentle falloff
    // leaves each feature smeared around most of the circumference, and the
    // combined lit area then runs from r 0.6 to the edge — a broad airbrushed
    // glow, where the reference keeps two separate crescents over short arcs.
    float caustic = smoothstep(0.62, 0.71, r) * smoothstep(0.82, 0.74, r);
    col += hue * caustic * (0.06 + 0.94 * pow(1.0 - up, 4.0)) * 2.6;

    // The soap-film edge itself: a hairline that keeps the silhouette readable
    // all the way round, including through the gaps between streaks.
    // Faint and tinted rather than white: a white hairline all the way round is
    // enough on its own to wash the shell's saturation out.
    float film = smoothstep(0.955, 0.99, r) * smoothstep(1.0, 0.99, r);
    col += mix(u_c1, vec3(1.0), 0.25) * film * 0.22;

    // Feather only wide enough to anti-alias the silhouette.
    float mask = smoothstep(1.0, 0.97, r);
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
        canvas.width = size * dpr;
        canvas.height = size * dpr;
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
                inset: 0,
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                pointerEvents: "none",
            }}
        />
    );
}
