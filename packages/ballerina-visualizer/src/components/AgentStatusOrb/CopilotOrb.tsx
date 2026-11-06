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

// When a suggestion arrives the orb hops three times, each lower than the last, then
// waits still. It squashes before take-off and on each landing and stretches in the air;
// going up eases out and coming down eases in. Heights are shares of the orb's own size.
export const HOP_DURATION_MS = 1300;

const orbHop = keyframes`
    0% { transform: translateY(0) scale(1, 1); animation-timing-function: ease-out; }
    7% { transform: translateY(0) scale(1.1, 0.88); animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1); }
    19% { transform: translateY(-30%) scale(0.94, 1.07); animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4); }
    30% { transform: translateY(0) scale(1.1, 0.88); animation-timing-function: ease-out; }
    35% { transform: translateY(0) scale(1, 1); animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1); }
    46% { transform: translateY(-16%) scale(0.97, 1.04); animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4); }
    56% { transform: translateY(0) scale(1.06, 0.93); animation-timing-function: ease-out; }
    61% { transform: translateY(0) scale(1, 1); animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1); }
    70% { transform: translateY(-7%) scale(0.99, 1.02); animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4); }
    79% { transform: translateY(0) scale(1.03, 0.97); animation-timing-function: ease-out; }
    88%, 100% { transform: translateY(0) scale(1, 1); }
`;

/** When the first hop lands (30% in): the moment the suggestion bubble appears. */
export const HOP_FIRST_LANDING_MS = Math.round(HOP_DURATION_MS * 0.3);

const Holder = styled.div<{ $size: number; $hopping: boolean }>`
    position: relative;
    width: ${(props: { $size: number }) => props.$size}px;
    height: ${(props: { $size: number }) => props.$size}px;
    flex: none;
    // Squash and stretch about the base, so the orb lands on the spot it left.
    transform-origin: 50% 100%;
    animation: ${(props: { $hopping: boolean }) => (props.$hopping ? orbHop : "none")} ${HOP_DURATION_MS}ms linear 1;
    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

// While Copilot works on a task, a soft aurora glows evenly round the orb: three blobs
// of colour, spaced 120 degrees apart at one distance, turn together and blur into one
// glow that is strongest behind the orb and fades outward, breathing as it turns. Sizes
// are shares of the orb, so the glow scales with it.
const AURORA_REACH_RATIO = 0.75;
const AURORA_BLUR_RATIO = 0.16;
const AURORA_BLOB_OFFSET_RATIO = 0.3;
const AURORA_BLOB_SIZE_RATIO = 1.05;
const AURORA_TURN_MS = 9000;
const AURORA_BREATHE_MS = 2400;
/** The third blob's colour, a violet between the orb's blue and orange. */
const AURORA_ACCENT = "#a77bff";
// Strongest behind the orb, gone by the edge of the glow: no hole and no ring edge.
const AURORA_MASK = "radial-gradient(circle, #000 28%, rgba(0, 0, 0, 0.55) 48%, transparent 70%)";

const auroraTurn = keyframes`
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
`;

const auroraBreathe = keyframes`
    0%, 100% { opacity: 0.7; transform: scale(0.96); }
    50% { opacity: 1; transform: scale(1.06); }
`;

// Normal blending, not screen: a screened glow all but disappears on a light editor theme.
const AuroraGlow = styled.div<{ $size: number }>`
    position: absolute;
    inset: -${(props: { $size: number }) => props.$size * AURORA_REACH_RATIO}px;
    pointer-events: none;
    filter: blur(${(props: { $size: number }) => props.$size * AURORA_BLUR_RATIO}px);
    -webkit-mask: ${AURORA_MASK};
    mask: ${AURORA_MASK};
    animation: ${auroraBreathe} ${AURORA_BREATHE_MS}ms ease-in-out infinite;
    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

const AuroraTurn = styled.div`
    position: absolute;
    inset: 0;
    animation: ${auroraTurn} ${AURORA_TURN_MS}ms linear infinite;
    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

const AuroraBlob = styled.div<{ $size: number; $color: string; $angle: number }>`
    position: absolute;
    left: 50%;
    top: 50%;
    width: ${(props: { $size: number }) => props.$size * AURORA_BLOB_SIZE_RATIO}px;
    height: ${(props: { $size: number }) => props.$size * AURORA_BLOB_SIZE_RATIO}px;
    margin: -${(props: { $size: number }) => (props.$size * AURORA_BLOB_SIZE_RATIO) / 2}px;
    border-radius: 50%;
    transform: rotate(${(props: { $angle: number }) => props.$angle}deg)
        translateY(-${(props: { $size: number }) => props.$size * AURORA_BLOB_OFFSET_RATIO}px);
    background: radial-gradient(circle, ${(props: { $color: string }) => props.$color} 0%, transparent 68%);
`;

function Aurora({ colors, size }: { colors: [string, string, string]; size: number }) {
    const blobs = [
        `color-mix(in srgb, ${colors[1]} 95%, transparent)`,
        `color-mix(in srgb, ${colors[2]} 85%, transparent)`,
        `color-mix(in srgb, ${AURORA_ACCENT} 75%, transparent)`,
    ];
    return (
        <AuroraGlow $size={size}>
            <AuroraTurn>
                {blobs.map((color, index) => (
                    <AuroraBlob key={index} $size={size} $color={color} $angle={index * 120} />
                ))}
            </AuroraTurn>
        </AuroraGlow>
    );
}

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

// While running the eyes stay wide open and glance left and right, holding at each side.
const EYE_DRIFT_RATIO = 0.06;
const DRIFT_PERIOD_MS = 4000;
const EYE_REST_TRANSITION_MS = 200;

// While a suggestion is up the eyes hold a little wider, another resting height.
const EYE_EAGER_HEIGHT_RATIO = EYE_HEIGHT_RATIO * 1.08;

// Dozing: half of each eye hidden under a flat lid, a slower swirl and slower,
// sparser blinks. The lid lifts over LID_TRANSITION_MS when it wakes.
const LID_DOZING = 0.5;
const LID_TRANSITION_MS = 400;
const DOZE_ENERGY = 0.25;
const DOZE_BLINK_MIN_MS = 7000;
const DOZE_BLINK_MAX_MS = 10000;
const DOZE_BLINK_DURATION_MS = 360;

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

type BlinkKind = "single" | "double" | "slow";
type EyeMotion = BlinkKind | "perk";

const EYE_MOTION: Record<EyeMotion, { name: ReturnType<typeof keyframes>; ms: number }> = {
    single: { name: eyeBlink, ms: BLINK_DURATION_MS },
    double: { name: eyeDoubleBlink, ms: DOUBLE_BLINK_DURATION_MS },
    slow: { name: eyeBlink, ms: DOZE_BLINK_DURATION_MS },
    perk: { name: eyePerk, ms: PERK_DURATION_MS },
};

/**
 * The blink currently playing, or null between blinks, with a fresh random gap
 * in between and an occasional double blink. A dozing orb blinks slowly, further
 * apart, and never doubles.
 *
 * The eye rests open: there is no second resting state to animate between, so
 * this drives a one-shot animation rather than a loop.
 */
function useBlink(dozing: boolean): BlinkKind | null {
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
            const gap = dozing
                ? DOZE_BLINK_MIN_MS + Math.random() * (DOZE_BLINK_MAX_MS - DOZE_BLINK_MIN_MS)
                : BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
            timer = setTimeout(() => {
                const kind: BlinkKind = dozing ? "slow" : Math.random() < DOUBLE_BLINK_CHANCE ? "double" : "single";
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
    }, [dozing]);
    return blink;
}

/**
 * True for `ms` each time `on` turns on; cut short if it turns off first. Drives
 * the one-off reactions to a suggestion arriving: the eye perk and the hops.
 */
function useBurst(on: boolean, ms: number): boolean {
    const [active, setActive] = useState(false);
    useEffect(() => {
        if (!on) {
            return;
        }
        setActive(true);
        const timer = setTimeout(() => setActive(false), ms);
        return () => {
            clearTimeout(timer);
            setActive(false);
        };
    }, [on, ms]);
    return active;
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
const Eye = styled.div<{ $size: number; $motion: EyeMotion | null; $openRatio: number; $lid: number }>`
    --eye-open: ${(props: { $size: number; $openRatio: number }) => props.$size * props.$openRatio}px;
    --eye-shut: ${(props: { $size: number }) => props.$size * EYE_SHUT_HEIGHT_RATIO}px;
    --eye-perk: ${(props: { $size: number }) => props.$size * EYE_PERK_HEIGHT_RATIO}px;
    width: ${(props: { $size: number }) => props.$size * EYE_WIDTH_RATIO}px;
    height: var(--eye-open);
    flex: none;
    border-radius: 999px;
    background: #ffffff;
    // A lid cuts the eye flat across the top and keeps its rounded bottom. The
    // negative insets leave room for the glow, so only the lid edge clips anything.
    clip-path: inset(${(props: { $lid: number }) => props.$lid * 100}% -300% -100% -300%);
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
    transition:
        height ${EYE_REST_TRANSITION_MS}ms ease-out,
        clip-path ${LID_TRANSITION_MS}ms ease;
    // The wider eye and the lid stay: they are poses, not motion.
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
    /** True while the orb is offering a suggestion: it hops three times and its eyes perk up, then it waits with wider eyes until this turns off. */
    noticing?: boolean;
    /** True while the orb dozes after the user has been away: heavy lids, slow blinks, a calmer swirl. */
    dozing?: boolean;
}

export function CopilotOrb({ state, colors, size, theme, noticing = false, dozing = false }: CopilotOrbProps) {
    const preferred = useOrbTheme();
    const blink = useBlink(dozing);
    const perking = useBurst(noticing, PERK_DURATION_MS);
    const hopping = useBurst(noticing, HOP_DURATION_MS);
    // A perk overrides any blink that lands on top of it.
    const motion: EyeMotion | null = perking ? "perk" : blink;
    const thinking = state === "running";
    // Suggestions only show while idle, so the eager eye never meets the running glance.
    const openRatio = noticing ? EYE_EAGER_HEIGHT_RATIO : EYE_HEIGHT_RATIO;
    const [webglFailed, setWebglFailed] = useState(false);
    // Must be referentially stable: ShaderOrb re-creates (and loses) its GL context whenever this changes.
    const handleWebglFailed = useCallback(() => setWebglFailed(true), []);

    const requested = theme ?? preferred;
    // The animated orb needs WebGL; fall back to the simple one when it can't render.
    const resolved: OrbTheme = requested === "animated" && webglFailed ? FALLBACK_ORB_THEME : requested;
    const energy = dozing ? DOZE_ENERGY : ORB_ENERGY[state];
    const lid = dozing ? LID_DOZING : 0;

    return (
        <Holder $size={size} $hopping={hopping}>
            {(state === "running" || state === "awaiting-input") && <Aurora colors={colors} size={size} />}
            {resolved === "animated" ? (
                <ShaderOrb colors={colors} energy={energy} size={size} onContextFailed={handleWebglFailed} />
            ) : (
                <GlassSphere colors={colors} />
            )}
            <IconOverlay>
                <Eyes $size={size} $thinking={thinking}>
                    <Eye $size={size} $motion={motion} $openRatio={openRatio} $lid={lid} />
                    <Eye $size={size} $motion={motion} $openRatio={openRatio} $lid={lid} />
                </Eyes>
            </IconOverlay>
        </Holder>
    );
}
