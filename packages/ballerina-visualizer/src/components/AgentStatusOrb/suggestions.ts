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

import type { MiniChatPrompt } from "./promptHandoff";

// ---------------------------------------------------------------------------
// Proactive suggestions.
//
// A low-code view notices work the Copilot could do and offers it; the orb is
// what shows the offer. It is the same sibling problem as the mini chat handoff
// in shared.ts, so the same small fan-out store. Only one offer is live at a
// time: two companions talking over each other is worse than either staying quiet.
// ---------------------------------------------------------------------------

/** Names the trigger, so each one is dismissed on its own. */
export type SuggestionKind = "data-mapper-unmapped" | "flow-errors" | "empty-body";

export interface CopilotSuggestion {
    kind: SuggestionKind;
    /** One line, shown beside the orb. */
    text: string;
    /** Label for the button that takes the offer up. */
    action: string;
    /** Handed to the mini chat when accepted. */
    prompt: MiniChatPrompt;
}

/**
 * When a second offer arrives while one is up, the more important one is shown:
 * code that does not build outranks work that is merely unfinished. Equal or lower
 * waits; it is raised again when its view next changes what it would offer.
 */
const SUGGESTION_PRIORITY: Record<SuggestionKind, number> = {
    "flow-errors": 3,
    "empty-body": 2,
    "data-mapper-unmapped": 1,
};

const suggestionListeners = new Set<(suggestion: CopilotSuggestion | null) => void>();
let currentSuggestion: CopilotSuggestion | null = null;

/**
 * Kinds the user has waved away. Being interrupted is only tolerable when
 * refusing sticks, so a dismissed kind stays quiet for the rest of the session.
 */
const dismissedSuggestions = new Set<SuggestionKind>();

/** How the user answered an offer. Withdrawing one (its view closed) is not an answer. */
export type SuggestionAnswer = "accepted" | "dismissed";

/**
 * After the user answers an offer, of any kind, the orb makes no other offer for
 * this long. Without it, each new kind adds another interruption on top of the last.
 */
export const SUGGESTION_COOLDOWN_MS = 3 * 60 * 1000;
let lastAnsweredAt: number | undefined;

/**
 * Returns false when the kind was refused before, the orb is cooling down, or an
 * offer of equal or higher priority is already up. A lower one gives way.
 */
export function offerSuggestion(suggestion: CopilotSuggestion): boolean {
    if (dismissedSuggestions.has(suggestion.kind)) {
        return false;
    }
    if (currentSuggestion && SUGGESTION_PRIORITY[currentSuggestion.kind] >= SUGGESTION_PRIORITY[suggestion.kind]) {
        return false;
    }
    if (lastAnsweredAt !== undefined && Date.now() - lastAnsweredAt < SUGGESTION_COOLDOWN_MS) {
        return false;
    }
    currentSuggestion = suggestion;
    suggestionListeners.forEach((listener) => listener(suggestion));
    return true;
}

/**
 * Ends the live offer. With no `answer` it is merely withdrawn. An answer starts
 * the cooldown, and "dismissed" also stops the same kind being offered again.
 */
export function clearSuggestion(kind?: SuggestionKind, answer?: SuggestionAnswer): void {
    if (!currentSuggestion || (kind && currentSuggestion.kind !== kind)) {
        return;
    }
    if (answer) {
        lastAnsweredAt = Date.now();
    }
    if (answer === "dismissed") {
        dismissedSuggestions.add(currentSuggestion.kind);
    }
    currentSuggestion = null;
    suggestionListeners.forEach((listener) => listener(null));
}

/** Clears the live offer, the record of what was refused, and the cooldown. */
export function __resetSuggestionStoreForTests(): void {
    currentSuggestion = null;
    lastAnsweredAt = undefined;
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
