/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
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

/**
 * Colors for the ambient Copilot surfaces.
 *
 * The orb's own sphere/shader colors are a fixed branded duotone (a dark
 * glass-ball base plus a warm/cool accent pair) — a deliberate standalone
 * identity rather than one that follows the editor theme, so the companion
 * reads the same everywhere it appears. The cool accent stays constant; the
 * warm accent shifts per run state so awaiting-input/completed/error are
 * still distinguishable by hue.
 *
 * The ambient input frame (`AmbientFrame`, via `stateColorVar()` /
 * `ambientBorderColor()`) is a separate, still theme-driven surface: it's a
 * thin highlight around existing VS Code UI, so it keeps following
 * `--vscode-*` tokens to stay consistent with the rest of the editor.
 */

import { useMemo } from "react";
import { AgentRunState } from "@wso2/ballerina-core";

type Rgb = [number, number, number];
type Hsl = [number, number, number];

/**
 * The base VS Code color token for each run state. All resolve per theme:
 * idle follows the primary accent; running uses the progress-bar token so it
 * reads as distinct from idle even when motion is disabled; the transient
 * states stay color-coded via semantic tokens.
 */
export function stateColorVar(state: AgentRunState): string {
    switch (state) {
        case "awaiting-input":
            return "var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))";
        case "completed":
            return "var(--vscode-charts-green)";
        case "error":
            return "var(--vscode-errorForeground, var(--vscode-charts-red))";
        case "running":
            return "var(--vscode-progressBar-background, var(--vscode-button-background))";
        case "idle":
        default:
            return "var(--vscode-button-background)";
    }
}

/**
 * Border/glow color for the ambient frame around the composer & hero input.
 *
 * The primary accent (idle/running) can sit close to the panel background in
 * some themes, making a thin accent border nearly invisible. Blend it toward
 * `--vscode-focusBorder` — the theme's designed-visible ring color — so the
 * frame keeps its accent identity but never disappears. The transient states
 * are already vivid (yellow/green/red), so they stay pure.
 */
export function ambientBorderColor(state: AgentRunState): string {
    if (state === "idle" || state === "running") {
        return "color-mix(in srgb, var(--vscode-button-background) 70%, var(--vscode-focusBorder))";
    }
    return stateColorVar(state);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Parse `#rgb` / `#rrggbb`. */
export function hexToRgb(hex: string): Rgb {
    let value = hex.trim().replace(/^#/, "");
    if (value.length === 3) {
        value = value.split("").map((ch) => ch + ch).join("");
    }
    const int = parseInt(value, 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
    const hex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function rgbToHsl([r, g, b]: Rgb): Hsl {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    const l = (max + min) / 2;
    if (delta === 0) {
        return [0, 0, l];
    }
    const s = delta / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === rn) {
        h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
        h = (bn - rn) / delta + 2;
    } else {
        h = (rn - gn) / delta + 4;
    }
    h = (h * 60 + 360) % 360;
    return [h, s, l];
}

export function hslToRgb([h, s, l]: Hsl): Rgb {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (h < 60) { [rp, gp, bp] = [c, x, 0]; }
    else if (h < 120) { [rp, gp, bp] = [x, c, 0]; }
    else if (h < 180) { [rp, gp, bp] = [0, c, x]; }
    else if (h < 240) { [rp, gp, bp] = [0, x, c]; }
    else if (h < 300) { [rp, gp, bp] = [x, 0, c]; }
    else { [rp, gp, bp] = [c, 0, x]; }
    return [(rp + m) * 255, (gp + m) * 255, (bp + m) * 255];
}

/** Shift a color's HSL lightness by `delta` (−1..1), keeping hue and saturation. */
export function shiftLightness(hex: string, delta: number): string {
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    return rgbToHex(hslToRgb([h, s, clamp(l + delta, 0.06, 0.96)]));
}

/** The orb's fixed dark glass-ball base — independent of the VS Code theme. */
const ORB_DARK_BASE = "#0a0e1a";

/** The orb's cool accent — constant across every run state. */
const ORB_COOL_ACCENT = "#4db8ff";

/** The orb's warm accent per run state — the half of the duotone that still carries the status signal. */
const ORB_WARM_ACCENT: Record<AgentRunState, string> = {
    idle: "#ff8a3d",
    running: "#ff8a3d",
    "awaiting-input": "#ffb020",
    completed: "#3ddc84",
    error: "#ff5252",
};

/**
 * The three shader stops for a run state: the fixed dark base plus the
 * cool/warm accent pair, so the orb keeps one branded duotone look everywhere
 * it's rendered instead of following the editor theme.
 */
export function deriveOrbColors(state: AgentRunState): [string, string, string] {
    return [ORB_DARK_BASE, ORB_COOL_ACCENT, ORB_WARM_ACCENT[state]];
}

export function useOrbColors(state: AgentRunState): [string, string, string] {
    return useMemo(() => deriveOrbColors(state), [state]);
}
