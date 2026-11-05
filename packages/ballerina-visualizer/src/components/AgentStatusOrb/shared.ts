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

import { useEffect, useLayoutEffect, useState } from "react";
import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";
import { AgentRunState, AgentRunStatus, ChatNotify, MACHINE_VIEW } from "@wso2/ballerina-core";
import { BallerinaRpcClient, useRpcContext } from "@wso2/ballerina-rpc-client";
import type { MiniChatPrompt } from "./promptHandoff";
import { ambientBorderColor } from "./orbTheme";

/** Floating orb geometry, shared with the mini chat for anchor-relative placement. */
export const ORB_SIZE = 56;

/**
 * Hover/focus lift shared by every clickable orb. Must stay above the ambient sphere pulse's own 1.13
 * peak, or the lift is indistinguishable from the idle animation.
 */
export const ORB_HOVER_BRIGHTNESS = 1.18;

export const ORB_GLOW_CLASS = "orb-glow";

/** Scopes the lift to the orb so sibling chrome in the same button is left alone. */
export const OrbGlow = styled.span`
    display: block;
    transition: filter 0.2s ease;
`;
export const EDGE_MARGIN = 20;

export type Anchor = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

export const ANCHOR_STORAGE_KEY = "ballerina.copilot.orbAnchor";

const ANCHORS: readonly Anchor[] = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];

export function loadAnchor(): Anchor {
    // Storage may be unavailable/quota-restricted in the webview — fall back to
    // the default anchor rather than throwing during render.
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(ANCHOR_STORAGE_KEY);
    } catch {
        stored = null;
    }
    // bottom-center sits on top of whatever the active view docks at its own
    // bottom-center (form submit buttons, artifact-picker cards, …), so default
    // to bottom-right instead; users can still drag the orb to any anchor.
    return stored && (ANCHORS as readonly string[]).includes(stored) ? (stored as Anchor) : "bottom-right";
}

/** Flow speed / contrast of the shader per state (0 = still, 1 = lively). */
export const ORB_ENERGY: Record<AgentRunState, number> = {
    // Raised across the board so the single-hue orb visibly flows (the motion,
    // not the color, is what carries "alive"). Running stays at the ceiling.
    "idle": 0.6,
    "running": 1.0,
    "awaiting-input": 0.72,
    "completed": 0.6,
    "error": 0.65,
};

const ambientGradientShift = keyframes`
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
`;

export type AmbientFrameVariant = "hero" | "composer";

interface AmbientFrameProps {
    $state?: AgentRunState;
    $variant?: AmbientFrameVariant;
}

/** The frame's base color (accent floored to focusBorder for visibility); tinted in CSS. */
function ambientBase(props: AmbientFrameProps): string {
    return ambientBorderColor(props.$state ?? "idle");
}

/**
 * Shared ambient AI frame used by the landing-page hero and full chat input.
 * The transcript remains neutral; this frame identifies the active Copilot surface.
 */
export const AmbientFrame = styled.div<AmbientFrameProps>`
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: ${(props: AmbientFrameProps) => props.$variant === "hero" ? "1.5px" : "1px"};
    border-radius: ${(props: AmbientFrameProps) => props.$variant === "hero" ? "14px" : "10px"};
    background: ${(props: AmbientFrameProps) => {
        // Monochromatic gradient tinted from the state's accent so the frame
        // reads as one theme color (light stop → base → dark stop).
        const base = ambientBase(props);
        return `linear-gradient(120deg,`
            + ` color-mix(in srgb, ${base} 82%, #ffffff),`
            + ` ${base},`
            + ` color-mix(in srgb, ${base} 80%, #000000),`
            + ` color-mix(in srgb, ${base} 82%, #ffffff))`;
    }};
    background-size: 300% 300%;
    animation: ${ambientGradientShift} 9s ease infinite;
    box-shadow: ${(props: AmbientFrameProps) => {
        const base = ambientBase(props);
        const hero = props.$variant === "hero";
        const active = !!props.$state && props.$state !== "idle";
        // Idle composer used to be the faintest (12/7); bump it so the frame
        // stays legible where the accent is muted or near the panel background.
        const outerStrength = hero ? 25 : active ? 20 : 18;
        const innerStrength = hero ? 12 : active ? 13 : 11;
        const outerSize = hero ? 18 : active ? 16 : 14;
        const innerSize = hero ? 10 : active ? 10 : 9;
        return `0 0 ${outerSize}px color-mix(in srgb, ${base} ${outerStrength}%, transparent), 0 0 ${innerSize}px color-mix(in srgb, ${base} ${innerStrength}%, transparent)`;
    }};
    transition: box-shadow 0.25s ease;

    &:focus-within {
        box-shadow: ${(props: AmbientFrameProps) => {
            const base = ambientBase(props);
            return `0 0 22px color-mix(in srgb, ${base} 34%, transparent), 0 0 13px color-mix(in srgb, ${base} 20%, transparent)`;
        }};
    }

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }

    @media (forced-colors: active) {
        padding: 1px;
        background: CanvasText;
        box-shadow: none;
        animation: none;
    }
`;

export const AWAITING_INPUT_LABEL = "Needs your input";

/**
 * User-facing label for a non-idle run state. Never names the product: every surface
 * that shows one already does — the orb tooltip, and the status bar the extension
 * builds from the same vocabulary.
 */
export function activeStateLabel(status: AgentRunStatus): string {
    switch (status.state) {
        case "completed":
            return "Done — click to open the chat";
        case "running":
            return status.label ?? "Working on it…";
        case "awaiting-input":
            return status.label ?? AWAITING_INPUT_LABEL;
        case "error":
            return status.label ?? "Something went wrong";
        default:
            return "Ready to chat";
    }
}

const spherePulse = keyframes`
    0%, 100% { transform: scale(1); filter: brightness(1); }
    50% { transform: scale(1.05); filter: brightness(1.13); }
`;

/** Drifts the highlight across the sphere — needs background-size > 100%. */
const sphereDrift = keyframes`
    0% { background-position: 30% 30%; }
    50% { background-position: 70% 62%; }
    100% { background-position: 30% 30%; }
`;
const sphereSheen = keyframes`
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
`;

interface SphereProps {
    colors: [string, string, string];
    /**
     * Flow speed in 0..1, from ORB_ENERGY. Drives the animation period so the
     * CSS sphere reads at roughly the same tempo as the shader it stands in for.
     *
     * Required, mirroring ShaderOrb's own required `energy`: every call site
     * renders one or the other from the same AgentRunState, and making this
     * optional let two of them silently render a running orb at idle tempo.
     */
    energy: number;
}

/**
 * CSS gradient sphere — the rendering for small indicators, where a live GL
 * context per orb isn't worth it (the chat footer's 16px "Generating" dot).
 * Orb-sized surfaces use `GlassSphere` below instead.
 *
 * It animates on its own rather than sitting still: a slow breathing pulse
 * plus a drifting highlight, both scaled by `energy`, so it never looks frozen.
 */
export const Sphere = styled.div<SphereProps>`
    position: absolute;
    inset: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    // Base has to dominate the body or this reads near-black on a light theme.
    background:
        radial-gradient(
            circle at 30% 24%,
            rgba(255, 255, 255, 0.55),
            rgba(255, 255, 255, 0.1) 24%,
            transparent 44%
        ),
        radial-gradient(
            circle at 74% 80%,
            color-mix(in srgb, ${(props: SphereProps) => props.colors[2]} 65%, transparent),
            transparent 50%
        ),
        radial-gradient(
            circle at 62% 34%,
            color-mix(in srgb, ${(props: SphereProps) => props.colors[2]} 55%, transparent),
            transparent 46%
        ),
        radial-gradient(
            circle at 26% 70%,
            color-mix(in srgb, ${(props: SphereProps) => props.colors[0]} 65%, transparent),
            transparent 48%
        ),
        radial-gradient(
            circle at 32% 28%,
            ${(props: SphereProps) => props.colors[2]},
            ${(props: SphereProps) => props.colors[1]} 52%,
            ${(props: SphereProps) => props.colors[0]} 100%
        );
    /*
     * Highlights stay at 100% so they never slide; the three tinted layers are
     * oversized by different amounts so one shared drift moves them at different
     * apparent speeds, which is what fakes the shader's liquid depth.
     */
    background-size: 100% 100%, 100% 100%, 220% 220%, 170% 170%, 180% 180%;
    box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.22),
        inset 0 9px 16px rgba(255, 255, 255, 0.1),
        inset 0 -8px 14px rgba(0, 0, 0, 0.16),
        0 0 14px color-mix(in srgb, ${(props: SphereProps) => props.colors[1]} 45%, transparent);

    body.vscode-dark &,
    body.vscode-high-contrast & {
        box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.22),
            inset 0 9px 16px rgba(255, 255, 255, 0.1),
            inset 0 -8px 14px rgba(0, 0, 0, 0.16),
            0 0 16px color-mix(in srgb, ${(props: SphereProps) => props.colors[1]} 24%, transparent);
    }
    animation:
        ${spherePulse} ${(props: SphereProps) => (4.2 - props.energy * 2.4).toFixed(2)}s ease-in-out infinite,
        ${sphereDrift} ${(props: SphereProps) => (7.5 - props.energy * 3.5).toFixed(2)}s ease-in-out infinite;

    // Slow sheen sweep — the CSS stand-in for the shader's motion.
    &::before {
        content: "";
        position: absolute;
        inset: -28%;
        background: conic-gradient(
            from 0deg,
            transparent 0 54%,
            rgba(255, 255, 255, 0.26) 72%,
            transparent 86%
        );
        animation: ${sphereSheen} ${(props: SphereProps) => (9 - props.energy * 4).toFixed(2)}s linear infinite;
        pointer-events: none;
    }

    /*
     * Both fallbacks also undo background-size: the enlarged box only exists so
     * the drift has room to travel, and leaving it scaled would render a
     * differently-shaped gradient than the unanimated original.
     */
    @media (prefers-reduced-motion: reduce), (forced-colors: active) {
        animation: none;
        background-size: 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%;

        &::before {
            display: none;
        }
    }
`;

const rimSpin = keyframes`
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
`;

interface GlassSphereProps {
    colors: [string, string, string];
}

/**
 * The rim's angular color ramp: a warm pair and a cool pair of streaks 90
 * degrees apart, each pair repeating every 180 degrees. Peaks are mixed toward
 * white because the streak cores read as blown out, and the stops fall to
 * transparent between lobes so the dark gaps stay crisp instead of smearing
 * warm into cool.
 */
function rimRamp(colors: [string, string, string], from: string): string {
    const cool = colors[1];
    const warm = colors[2];
    const hot = (color: string) => `color-mix(in srgb, ${color} 35%, #ffffff)`;
    const fade = (color: string) => `color-mix(in srgb, ${color} 30%, transparent)`;
    return `repeating-conic-gradient(
        from ${from},
        ${hot(warm)} 0deg,
        ${warm} 9deg,
        ${fade(warm)} 24deg,
        transparent 40deg,
        transparent 50deg,
        ${fade(cool)} 66deg,
        ${hot(cool)} 90deg,
        ${cool} 99deg,
        ${fade(cool)} 114deg,
        transparent 130deg,
        transparent 140deg,
        ${fade(warm)} 156deg,
        ${hot(warm)} 180deg
    )`;
}

/**
 * CSS glass bubble — the `simple` orb theme, and the fallback when a WebGL
 * context can't be created. Mirrors what `ShaderOrb` renders: a dark body, a
 * thin rim carrying the warm/cool streak pairs, and a dimmer inner wall
 * carrying the opposite pair, the whole set turning once every 11s (the same
 * rate the shader spins its rim).
 *
 * Deliberately not used for small indicators: at ~16px the four lobes collapse
 * into unreadable specks, so the chat footer's dot keeps the filled `Sphere`.
 */
export const GlassSphere = styled.div<GlassSphereProps>`
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: radial-gradient(
        circle at 34% 26%,
        color-mix(in srgb, ${(props: GlassSphereProps) => props.colors[0]} 76%, #ffffff) 0%,
        ${(props: GlassSphereProps) => props.colors[0]} 46%,
        color-mix(in srgb, ${(props: GlassSphereProps) => props.colors[0]} 72%, #000000) 100%
    );
    box-shadow:
        inset 0 -5px 12px rgba(0, 0, 0, 0.45),
        0 0 14px color-mix(in srgb, ${(props: GlassSphereProps) => props.colors[1]} 40%, transparent);

    /* Outer rim. */
    &::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: ${(props: GlassSphereProps) => rimRamp(props.colors, "0deg")};
        -webkit-mask: radial-gradient(closest-side, transparent 88%, #000 97%);
        mask: radial-gradient(closest-side, transparent 88%, #000 97%);
        animation: ${rimSpin} 11s linear infinite;
        pointer-events: none;
    }

    /* Inner glass wall — the opposite pair, dimmer and further in. */
    &::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: ${(props: GlassSphereProps) => rimRamp(props.colors, "90deg")};
        -webkit-mask: radial-gradient(closest-side, transparent 70%, #000 80%, #000 85%, transparent 92%);
        mask: radial-gradient(closest-side, transparent 70%, #000 80%, #000 85%, transparent 92%);
        opacity: 0.4;
        animation: ${rimSpin} 11s linear infinite;
        pointer-events: none;
    }

    @media (prefers-reduced-motion: reduce), (forced-colors: active) {
        &::before,
        &::after {
            animation: none;
        }
    }
`;

/** Glass reflection overlay — sits on top of both the shader and CSS spheres. */
export const Gloss = styled.div`
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.04) 30%, transparent 50%);
    pointer-events: none;
`;

/** Centers the copilot glyph over the sphere — shared by the orb and hero box. */
export const IconOverlay = styled.div`
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
`;

// ---------------------------------------------------------------------------
// Agent-run-status fan-out.
//
// vscode-messenger keeps ONE handler per notification method
// (handlerRegistry.set), so a second onAgentRunStatusChanged subscriber would
// silently replace the first. This store owns the single messenger
// subscription (plus the initial pull) and fans updates out to any number of
// components (floating orb, landing-page hero box, ...).
// ---------------------------------------------------------------------------

let currentStatus: AgentRunStatus | null = null;
let statusWired = false;
// A live status notification can arrive before the initial getAgentRunStatus()
// pull resolves; once one has, the (older) pull result must not clobber it.
let receivedStatusNotification = false;
const statusListeners = new Set<(status: AgentRunStatus | null) => void>();

function publishStatus(status: AgentRunStatus | null) {
    currentStatus = status;
    statusListeners.forEach((listener) => listener(status));
}

export function subscribeAgentRunStatus(
    rpcClient: BallerinaRpcClient,
    listener: (status: AgentRunStatus | null) => void
): () => void {
    statusListeners.add(listener);
    if (statusWired) {
        listener(currentStatus);
    } else {
        statusWired = true;
        rpcClient
            .getCommonRpcClient()
            .getAgentRunStatus()
            .then((status) => {
                // Skip if a live notification already delivered a fresher status.
                if (!receivedStatusNotification) {
                    publishStatus(status);
                }
            })
            .catch(() => {
                // Older extension host without the RPC — status stays null.
            });
        rpcClient.onAgentRunStatusChanged((status) => {
            receivedStatusNotification = true;
            publishStatus(status);
        });
    }
    return () => {
        statusListeners.delete(listener);
    };
}

/** Test-only: clears the module-level status cache and listeners between test cases. */
export function __resetAgentRunStatusStoreForTests(): void {
    currentStatus = null;
    statusWired = false;
    receivedStatusNotification = false;
    statusListeners.clear();
}

/**
 * True while the Copilot panel is open — inline copilot surfaces stand down so
 * the panel is the only chat entry point. Seeded from the cached status so a
 * remount does not flash the surface it is about to hide.
 */
export function useAiPanelOpen(): boolean {
    const { rpcClient } = useRpcContext();
    const [open, setOpen] = useState(() => currentStatus?.aiPanelOpen ?? false);

    useEffect(() => {
        if (!rpcClient) {
            return;
        }
        return subscribeAgentRunStatus(rpcClient, (status) => setOpen(status?.aiPanelOpen ?? false));
    }, [rpcClient]);

    return open;
}

/** The live run state — says nothing about what the turn will produce. */
export function useAgentRunState(): AgentRunState | undefined {
    const { rpcClient } = useRpcContext();
    const [state, setState] = useState(() => currentStatus?.state);

    useEffect(() => {
        if (!rpcClient) {
            return;
        }
        return subscribeAgentRunStatus(rpcClient, (status) => setState(status?.state));
    }, [rpcClient]);

    return state;
}

// ---------------------------------------------------------------------------
// Contextual mini-chat launch requests.
//
// Diagram actions and the orb are siblings in the visualizer tree. Keep their
// handoff in this small fan-out store so the diagram can pass the complete
// typed prompt (especially CodeContext) without opening the extension panel.
// ---------------------------------------------------------------------------

const miniChatOpenListeners = new Set<(prompt: MiniChatPrompt) => void>();

/**
 * Ask the ambient Copilot surface to open with a contextual prompt.
 * Returns false only when the orb has not mounted, allowing a full-panel fallback.
 */
export function requestMiniChatOpen(prompt: MiniChatPrompt): boolean {
    if (miniChatOpenListeners.size === 0) {
        return false;
    }
    miniChatOpenListeners.forEach((listener) => listener(prompt));
    return true;
}

export function subscribeMiniChatOpen(listener: (prompt: MiniChatPrompt) => void): () => void {
    miniChatOpenListeners.add(listener);
    return () => {
        miniChatOpenListeners.delete(listener);
    };
}

// ---------------------------------------------------------------------------
// Proactive suggestions.
//
// A low-code view notices work the Copilot could do and offers it; the orb is
// what shows the offer. Same sibling problem as the handoff above, so the same
// small fan-out store. Only one offer is live at a time: two companions talking
// over each other is worse than either staying quiet.
// ---------------------------------------------------------------------------

/** Names the trigger, so each one is dismissed on its own. */
export type SuggestionKind = "data-mapper-unmapped";

export interface CopilotSuggestion {
    kind: SuggestionKind;
    /** One line, shown beside the orb. */
    text: string;
    /** Label for the button that takes the offer up. */
    action: string;
    /** Handed to the mini chat when accepted. */
    prompt: MiniChatPrompt;
}

const suggestionListeners = new Set<(suggestion: CopilotSuggestion | null) => void>();
let currentSuggestion: CopilotSuggestion | null = null;

/**
 * Kinds the user has waved away. Being interrupted is only tolerable when
 * refusing sticks, so a dismissed kind stays quiet for the rest of the session.
 */
const dismissedSuggestions = new Set<SuggestionKind>();

/** Returns false when the offer was refused before, or another is already up. */
export function offerSuggestion(suggestion: CopilotSuggestion): boolean {
    if (currentSuggestion || dismissedSuggestions.has(suggestion.kind)) {
        return false;
    }
    currentSuggestion = suggestion;
    suggestionListeners.forEach((listener) => listener(suggestion));
    return true;
}

/**
 * Withdraws the live offer. `dismissed` marks it as refused rather than merely
 * over, which is what stops the same trigger raising it again.
 */
export function clearSuggestion(kind?: SuggestionKind, dismissed = false): void {
    if (!currentSuggestion || (kind && currentSuggestion.kind !== kind)) {
        return;
    }
    if (dismissed) {
        dismissedSuggestions.add(currentSuggestion.kind);
    }
    currentSuggestion = null;
    suggestionListeners.forEach((listener) => listener(null));
}

/** Clears both the live offer and the record of what was refused. */
export function __resetSuggestionStoreForTests(): void {
    currentSuggestion = null;
    dismissedSuggestions.clear();
    suggestionListeners.clear();
}

/** Replays the live offer on subscribe, since the orb can mount after it is made. */
export function subscribeSuggestion(listener: (suggestion: CopilotSuggestion | null) => void): () => void {
    suggestionListeners.add(listener);
    listener(currentSuggestion);
    return () => {
        suggestionListeners.delete(listener);
    };
}

// ---------------------------------------------------------------------------
// Copilot chat stream (mini chat).
//
// The extension mirrors onChatNotify events to the visualizer webview on the
// dedicated onCopilotChatNotify method while the AI panel is closed. Same
// one-handler-per-method constraint as above, so the single messenger
// registration lives here and fans out.
// ---------------------------------------------------------------------------

let chatWired = false;
const chatListeners = new Set<(msg: ChatNotify) => void>();

export function subscribeCopilotChatNotify(
    rpcClient: BallerinaRpcClient,
    listener: (msg: ChatNotify) => void
): () => void {
    chatListeners.add(listener);
    if (!chatWired) {
        chatWired = true;
        rpcClient.onCopilotChatNotify((msg) => chatListeners.forEach((l) => l(msg)));
    }
    return () => {
        chatListeners.delete(listener);
    };
}

// ---------------------------------------------------------------------------
// Floating-orb suppression.
//
// A view opts out of the floating orb either because its own hero box is the
// copilot surface there, or because it deliberately offers no ambient copilot.
// ---------------------------------------------------------------------------

let orbSuppressCount = 0;
const orbSuppressListeners = new Set<(suppressed: boolean) => void>();

function notifyOrbSuppressed() {
    orbSuppressListeners.forEach((listener) => listener(orbSuppressCount > 0));
}

/**
 * Hides the floating orb while the caller is mounted and `suppressed` holds.
 * Layout effect, not passive: suppression has to land in the same frame as the
 * render that caused it, or the orb paints once over a view that opts out.
 */
export function useSuppressAgentStatusOrb(suppressed = true): void {
    useLayoutEffect(() => {
        if (!suppressed) {
            return;
        }
        orbSuppressCount++;
        notifyOrbSuppressed();
        return () => {
            orbSuppressCount--;
            notifyOrbSuppressed();
        };
    }, [suppressed]);
}

/**
 * The views the ambient orb shows on: the project's hubs, design canvases, forms
 * and config pages, where Copilot can work on the open project. Setup/welcome
 * pages (no project yet), Copilot's own views and anything still loading go
 * without it, so a view added later has to opt in rather than inherit the overlay.
 */
const VIEWS_WITH_ORB: ReadonlySet<MACHINE_VIEW> = new Set([
    MACHINE_VIEW.PackageOverview,
    MACHINE_VIEW.BIComponentView,
    MACHINE_VIEW.BIDiagram,
    MACHINE_VIEW.ServiceDesigner,
    MACHINE_VIEW.BIServiceClassDesigner,
    MACHINE_VIEW.AIAgentDesigner,
    MACHINE_VIEW.ERDiagram,
    MACHINE_VIEW.TypeDiagram,
    MACHINE_VIEW.GraphQLDiagram,
    MACHINE_VIEW.DataMapper,
    MACHINE_VIEW.InlineDataMapper,
    MACHINE_VIEW.WorkspaceOverview,
    MACHINE_VIEW.SequenceDiagram,
    MACHINE_VIEW.AddConnectionWizard,
    MACHINE_VIEW.AddAgent,
    MACHINE_VIEW.AddAgentDefinition,
    MACHINE_VIEW.ConnectionConfiguration,
    MACHINE_VIEW.AddCustomConnector,
    MACHINE_VIEW.ViewConfigVariables,
    MACHINE_VIEW.EditConfigVariables,
    MACHINE_VIEW.AddConfigVariables,
    MACHINE_VIEW.EditConnectionWizard,
    MACHINE_VIEW.BIMainFunctionForm,
    MACHINE_VIEW.BIFunctionForm,
    MACHINE_VIEW.BIAgentToolForm,
    MACHINE_VIEW.BIWorkflowForm,
    MACHINE_VIEW.BIDurableAgentForm,
    MACHINE_VIEW.BIActivityForm,
    MACHINE_VIEW.BINPFunctionForm,
    MACHINE_VIEW.BITestFunctionForm,
    MACHINE_VIEW.BIAIEvaluationForm,
    MACHINE_VIEW.BIServiceWizard,
    MACHINE_VIEW.BIServiceConfigView,
    MACHINE_VIEW.BIListenerConfigView,
    MACHINE_VIEW.AgentDefinitionDesigner,
    MACHINE_VIEW.BIServiceClassConfigView,
    MACHINE_VIEW.BIDataMapperForm,
    MACHINE_VIEW.AIChatAgentWizard,
    MACHINE_VIEW.ServiceFunctionForm,
    MACHINE_VIEW.AIAgentToolForm,
    MACHINE_VIEW.EvalsetViewer,
    MACHINE_VIEW.ConfigurationCollector,
]);

export function viewHidesAgentStatusOrb(view: MACHINE_VIEW | null | undefined): boolean {
    return !view || !VIEWS_WITH_ORB.has(view);
}

export function subscribeOrbSuppressed(listener: (suppressed: boolean) => void): () => void {
    orbSuppressListeners.add(listener);
    listener(orbSuppressCount > 0);
    return () => {
        orbSuppressListeners.delete(listener);
    };
}

// ---------------------------------------------------------------------------
// Ambient Copilot presence.
//
// True while an in-context opener (the floating orb or the overview composer)
// is on screen. The extension mirrors this into `ballerina.copilotAmbientPresent`
// so the legacy editor-title icon only shows where no ambient surface exists.
// ---------------------------------------------------------------------------

let ambientPresenceCount = 0;
const ambientPresenceListeners = new Set<(present: boolean) => void>();

function notifyAmbientPresence() {
    ambientPresenceListeners.forEach((listener) => listener(ambientPresenceCount > 0));
}

/**
 * Registers an ambient Copilot surface while the caller is mounted and `present`
 * holds. Layout effect so presence lands in the same frame as the render, matching
 * orb suppression and avoiding a one-frame flash of the legacy icon.
 */
export function useAmbientCopilotPresence(present = true): void {
    useLayoutEffect(() => {
        if (!present) {
            return;
        }
        ambientPresenceCount++;
        notifyAmbientPresence();
        return () => {
            ambientPresenceCount--;
            notifyAmbientPresence();
        };
    }, [present]);
}

export function subscribeAmbientCopilotPresence(listener: (present: boolean) => void): () => void {
    ambientPresenceListeners.add(listener);
    listener(ambientPresenceCount > 0);
    return () => {
        ambientPresenceListeners.delete(listener);
    };
}

// animated: WebGL shader glass bubble (default). simple: the CSS GlassSphere,
// which stands in for it — also the fallback when animated can't render. Add a
// theme by appending it here and to the `ballerina.copilot.orbTheme` enum.
export const ORB_THEMES = ["animated", "simple"] as const;
export type OrbTheme = typeof ORB_THEMES[number];

export const DEFAULT_ORB_THEME: OrbTheme = "animated";
export const FALLBACK_ORB_THEME: OrbTheme = "simple";

export function orbThemeFromSetting(value: string): OrbTheme {
    return (ORB_THEMES as readonly string[]).includes(value) ? (value as OrbTheme) : FALLBACK_ORB_THEME;
}

let currentOrbTheme: OrbTheme = DEFAULT_ORB_THEME;
const orbThemeListeners = new Set<(theme: OrbTheme) => void>();

export function getOrbTheme(): OrbTheme {
    return currentOrbTheme;
}

export function setOrbTheme(theme: OrbTheme): void {
    if (theme === currentOrbTheme) {
        return;
    }
    currentOrbTheme = theme;
    orbThemeListeners.forEach((listener) => listener(theme));
}

export function subscribeOrbTheme(listener: (theme: OrbTheme) => void): () => void {
    orbThemeListeners.add(listener);
    return () => {
        orbThemeListeners.delete(listener);
    };
}

export function useOrbTheme(): OrbTheme {
    const [theme, setTheme] = useState<OrbTheme>(currentOrbTheme);
    useEffect(() => subscribeOrbTheme(setTheme), []);
    return theme;
}

let orbThemeSynced = false;

export function syncOrbThemeFromSetting(rpcClient: BallerinaRpcClient): void {
    if (orbThemeSynced) {
        return;
    }
    orbThemeSynced = true;
    rpcClient
        .getCommonRpcClient()
        .getCopilotOrbTheme()
        .then((value: string) => setOrbTheme(orbThemeFromSetting(value)))
        .catch((): void => { /* older host without the RPC — keep the default */ });
}
