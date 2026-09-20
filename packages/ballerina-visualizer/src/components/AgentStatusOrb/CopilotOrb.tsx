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

import { useCallback, useState } from "react";
import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";
import { AgentRunState } from "@wso2/ballerina-core";
import { ShaderOrb } from "./ShaderOrb";
import { FALLBACK_ORB_THEME, GlassSphere, IconOverlay, ORB_ENERGY, OrbTheme, useOrbTheme } from "./shared";

const rotate = keyframes`
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
`;

const haloPulse = keyframes`
    0%, 100% { opacity: 0.25; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.18); }
`;

const Holder = styled.div<{ $size: number }>`
    position: relative;
    width: ${(props: { $size: number }) => props.$size}px;
    height: ${(props: { $size: number }) => props.$size}px;
    flex: none;
`;

interface ColorsProps {
    colors: [string, string, string];
}

const Halo = styled.div<ColorsProps>`
    position: absolute;
    inset: -16px;
    border-radius: 50%;
    background: radial-gradient(circle, ${(props: ColorsProps) => props.colors[1]} 0%, transparent 70%);
    animation: ${haloPulse} 1.8s ease-in-out infinite;
    pointer-events: none;
    @media (prefers-reduced-motion: reduce) {
        animation: none;
        opacity: 0.4;
    }
`;

const SpinArc = styled.div`
    position: absolute;
    inset: -2px;
    border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: var(--vscode-button-foreground);
    animation: ${rotate} 1.1s linear infinite;
    pointer-events: none;
    @media (prefers-reduced-motion: reduce) {
        display: none;
    }
`;

// Geometry measured off the product's reference recording, as fractions of the
// orb's diameter. The eye rests as a 2:1 pill and shuts to a flat slit; only its
// height ever changes, the width holding constant through the blink.
const EYE_WIDTH_RATIO = 0.098;
const EYE_HEIGHT_RATIO = 0.194;
const EYE_SHUT_HEIGHT_RATIO = 0.034;
const EYE_GAP_RATIO = 0.193;

// Blink timing, measured over the reference's 3.5s at 60fps: four blinks, one
// every 0.85s, each lasting 0.2s split evenly into closing, held shut, and
// opening. The reference holds no second resting state — it is open except for
// those blinks — and it interpolates linearly, its mid-blink frames landing on
// the midpoint height, so this must not ease.
const BLINK_PERIOD_S = 0.85;
const BLINK_DOWN_PCT = 76;
const BLINK_SHUT_PCT = 84;
const BLINK_UP_PCT = 92;

// Animates height rather than scaleY: `border-radius` resolves against the
// unscaled box, so scaling squashes the corner radii into ellipses and the
// blink lands on a rounded square instead of a flat slit.
const eyeMorph = keyframes`
    0%, ${BLINK_DOWN_PCT}% { height: var(--eye-open); }
    ${BLINK_SHUT_PCT}%, ${BLINK_UP_PCT}% { height: var(--eye-shut); }
    100% { height: var(--eye-open); }
`;

const Eyes = styled.div<{ $size: number }>`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${(props: { $size: number }) => props.$size * EYE_GAP_RATIO}px;
    pointer-events: none;
`;

/**
 * A single companion "eye" — alternates between a tall pill and a round dot.
 *
 * Fixed white rather than a theme token: the sphere behind it is now always
 * dark, so a theme-driven foreground could leave the eyes unreadable.
 */
const Eye = styled.div<{ $size: number }>`
    --eye-open: ${(props: { $size: number }) => props.$size * EYE_HEIGHT_RATIO}px;
    --eye-shut: ${(props: { $size: number }) => props.$size * EYE_SHUT_HEIGHT_RATIO}px;
    width: ${(props: { $size: number }) => props.$size * EYE_WIDTH_RATIO}px;
    height: var(--eye-open);
    flex: none;
    border-radius: 999px;
    background: #ffffff;
    // Tight on purpose: a wider halo spills across the middle of the sphere and
    // lifts it off the near-black the reference keeps between the eyes.
    box-shadow:
        0 0 ${(props: { $size: number }) => props.$size * 0.04}px rgba(255, 255, 255, 0.6),
        0 0 ${(props: { $size: number }) => props.$size * 0.08}px rgba(255, 180, 120, 0.3);
    animation: ${eyeMorph} ${BLINK_PERIOD_S}s linear infinite;
    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

export interface CopilotOrbProps {
    state: AgentRunState;
    colors: [string, string, string];
    size: number;
    /** Pins a theme instead of following the shared preference. */
    theme?: OrbTheme;
}

export function CopilotOrb({ state, colors, size, theme }: CopilotOrbProps) {
    const preferred = useOrbTheme();
    const [webglFailed, setWebglFailed] = useState(false);
    // Must be referentially stable: ShaderOrb re-creates (and loses) its GL context whenever this changes.
    const handleWebglFailed = useCallback(() => setWebglFailed(true), []);

    const requested = theme ?? preferred;
    // The animated orb needs WebGL; fall back to the simple one when it can't render.
    const resolved: OrbTheme = requested === "animated" && webglFailed ? FALLBACK_ORB_THEME : requested;
    const energy = ORB_ENERGY[state];

    return (
        <Holder $size={size}>
            {(state === "running" || state === "awaiting-input") && <Halo colors={colors} />}
            {resolved === "animated" ? (
                <ShaderOrb colors={colors} energy={energy} size={size} onContextFailed={handleWebglFailed} />
            ) : (
                <GlassSphere colors={colors} />
            )}
            {state === "running" && <SpinArc />}
            <IconOverlay>
                <Eyes $size={size}>
                    <Eye $size={size} />
                    <Eye $size={size} />
                </Eyes>
            </IconOverlay>
        </Holder>
    );
}
