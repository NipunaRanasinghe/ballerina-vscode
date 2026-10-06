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

import { useCallback, useEffect, useState } from "react";
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

// One blink lasts 0.2s, measured off the reference at 60fps, split evenly into
// closing, held shut, and opening. The reference interpolates linearly — its
// mid-blink frames land on the midpoint height — so this must not ease.
const BLINK_DURATION_MS = 200;

// The gap between blinks is drawn fresh each time rather than fixed. The
// reference's own gaps vary (0.78 / 0.89 / 0.85s measured), and a fixed CSS loop
// reads as mechanical next to that. The range averages 5s.
const BLINK_MIN_MS = 4000;
const BLINK_MAX_MS = 6000;

// About one blink in six comes as a quick pair. The eyes reopen for only a
// short gap in between, so the pair reads as one gesture rather than two blinks.
const DOUBLE_BLINK_CHANCE = 1 / 6;
const DOUBLE_BLINK_GAP_MS = 50;
const DOUBLE_BLINK_DURATION_MS = 2 * BLINK_DURATION_MS + DOUBLE_BLINK_GAP_MS;

// When the orb starts offering a suggestion the eyes widen, double-blink from
// the widened height, then settle back to their resting size.
const EYE_PERK_HEIGHT_RATIO = EYE_HEIGHT_RATIO * 1.15;
const PERK_DURATION_MS = 900;

// While running the eyes squint and glance left and right, holding at each side.
// The squint is a resting height, so blinks start and end on it.
const EYE_SQUINT_HEIGHT_RATIO = EYE_HEIGHT_RATIO * 0.65;
const EYE_DRIFT_RATIO = 0.06;
const DRIFT_PERIOD_MS = 4000;
const SQUINT_TRANSITION_MS = 200;

// Animates height rather than scaleY: `border-radius` resolves against the
// unscaled box, so scaling squashes the corner radii into ellipses and the
// blink lands on a rounded square instead of a flat slit.
const eyeBlink = keyframes`
    0% { height: var(--eye-open); }
    33%, 67% { height: var(--eye-shut); }
    100% { height: var(--eye-open); }
`;

// Two of the blinks above back to back, each phase keeping the single blink's length.
const BLINK_PHASE_MS = BLINK_DURATION_MS / 3;
const SECOND_BLINK_MS = BLINK_DURATION_MS + DOUBLE_BLINK_GAP_MS;
const atDouble = (ms: number) => `${((ms / DOUBLE_BLINK_DURATION_MS) * 100).toFixed(2)}%`;
const eyeDoubleBlink = keyframes`
    0% { height: var(--eye-open); }
    ${atDouble(BLINK_PHASE_MS)}, ${atDouble(2 * BLINK_PHASE_MS)} { height: var(--eye-shut); }
    ${atDouble(BLINK_DURATION_MS)}, ${atDouble(SECOND_BLINK_MS)} { height: var(--eye-open); }
    ${atDouble(SECOND_BLINK_MS + BLINK_PHASE_MS)}, ${atDouble(SECOND_BLINK_MS + 2 * BLINK_PHASE_MS)} { height: var(--eye-shut); }
    100% { height: var(--eye-open); }
`;

// Widen, hold, blink twice from the widened height, hold, settle. The blinks'
// close and open phases land within a few ms of the single blink's.
const eyePerk = keyframes`
    0% { height: var(--eye-open); }
    15%, 35% { height: var(--eye-perk); }
    42% { height: var(--eye-shut); }
    50% { height: var(--eye-perk); }
    57% { height: var(--eye-shut); }
    65%, 85% { height: var(--eye-perk); }
    100% { height: var(--eye-open); }
`;

const eyeDrift = keyframes`
    0%, 100% { transform: translateX(0); }
    20%, 35% { transform: translateX(calc(-1 * var(--eye-drift))); }
    65%, 80% { transform: translateX(var(--eye-drift)); }
`;

type BlinkKind = "single" | "double";
type EyeMotion = BlinkKind | "perk";

const EYE_MOTION: Record<EyeMotion, { name: ReturnType<typeof keyframes>; ms: number }> = {
    single: { name: eyeBlink, ms: BLINK_DURATION_MS },
    double: { name: eyeDoubleBlink, ms: DOUBLE_BLINK_DURATION_MS },
    perk: { name: eyePerk, ms: PERK_DURATION_MS },
};

/**
 * The blink currently playing, or null between blinks, with a fresh random gap
 * in between and an occasional double blink.
 *
 * The eye rests open: there is no second resting state to animate between, so
 * this drives a one-shot animation rather than a loop.
 */
function useBlink(): BlinkKind | null {
    const [blink, setBlink] = useState<BlinkKind | null>(null);
    useEffect(() => {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stop = () => {
            clearTimeout(timer);
            timer = undefined;
            setBlink(null);
        };
        const schedule = () => {
            const gap = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
            timer = setTimeout(() => {
                const kind: BlinkKind = Math.random() < DOUBLE_BLINK_CHANCE ? "double" : "single";
                setBlink(kind);
                timer = setTimeout(() => {
                    setBlink(null);
                    schedule();
                }, EYE_MOTION[kind].ms);
            }, gap);
        };
        const applyMotionPreference = () => {
            stop();
            if (!reducedMotion.matches) {
                schedule();
            }
        };
        applyMotionPreference();
        reducedMotion.addEventListener("change", applyMotionPreference);
        return () => {
            reducedMotion.removeEventListener("change", applyMotionPreference);
            stop();
        };
    }, []);
    return blink;
}

/** True for one perk each time `noticing` turns on; cut short if it turns off first. */
function usePerk(noticing: boolean): boolean {
    const [perking, setPerking] = useState(false);
    useEffect(() => {
        if (!noticing) {
            return;
        }
        setPerking(true);
        const timer = setTimeout(() => setPerking(false), PERK_DURATION_MS);
        return () => {
            clearTimeout(timer);
            setPerking(false);
        };
    }, [noticing]);
    return perking;
}

const Eyes = styled.div<{ $size: number; $thinking: boolean }>`
    --eye-drift: ${(props: { $size: number }) => props.$size * EYE_DRIFT_RATIO}px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${(props: { $size: number }) => props.$size * EYE_GAP_RATIO}px;
    pointer-events: none;
    animation: ${(props: { $thinking: boolean }) => (props.$thinking ? eyeDrift : "none")} ${DRIFT_PERIOD_MS}ms
        ease-in-out infinite;
    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

/**
 * A single companion "eye" — alternates between a tall pill and a round dot.
 *
 * Fixed white rather than a theme token: the sphere behind it is now always
 * dark, so a theme-driven foreground could leave the eyes unreadable.
 */
const Eye = styled.div<{ $size: number; $motion: EyeMotion | null; $squint: boolean }>`
    --eye-open: ${(props: { $size: number; $squint: boolean }) =>
        props.$size * (props.$squint ? EYE_SQUINT_HEIGHT_RATIO : EYE_HEIGHT_RATIO)}px;
    --eye-shut: ${(props: { $size: number }) => props.$size * EYE_SHUT_HEIGHT_RATIO}px;
    --eye-perk: ${(props: { $size: number }) => props.$size * EYE_PERK_HEIGHT_RATIO}px;
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
    // Dropping back to \`none\` between blinks is what lets the next one restart
    // the animation; a looping keyframe could not take a random gap.
    animation-name: ${(props: { $motion: EyeMotion | null }) => (props.$motion ? EYE_MOTION[props.$motion].name : "none")};
    animation-duration: ${(props: { $motion: EyeMotion | null }) => (props.$motion ? EYE_MOTION[props.$motion].ms : 0)}ms;
    animation-timing-function: linear;
    transition: height ${SQUINT_TRANSITION_MS}ms ease-out;
    // The squint itself stays: it is a pose, not motion.
    @media (prefers-reduced-motion: reduce) {
        animation: none;
        transition: none;
    }
`;

export interface CopilotOrbProps {
    state: AgentRunState;
    colors: [string, string, string];
    size: number;
    /** Pins a theme instead of following the shared preference. */
    theme?: OrbTheme;
    /** True while the orb is offering a suggestion; the eyes perk up once when it turns on. */
    noticing?: boolean;
}

export function CopilotOrb({ state, colors, size, theme, noticing = false }: CopilotOrbProps) {
    const preferred = useOrbTheme();
    const blink = useBlink();
    const perking = usePerk(noticing);
    // A perk overrides any blink that lands on top of it.
    const motion: EyeMotion | null = perking ? "perk" : blink;
    const thinking = state === "running";
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
                <Eyes $size={size} $thinking={thinking}>
                    <Eye $size={size} $motion={motion} $squint={thinking} />
                    <Eye $size={size} $motion={motion} $squint={thinking} />
                </Eyes>
            </IconOverlay>
        </Holder>
    );
}
