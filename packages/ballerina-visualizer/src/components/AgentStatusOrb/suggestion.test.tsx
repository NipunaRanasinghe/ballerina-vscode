/*
 *  Copyright (c) 2026, WSO2 LLC. (http://www.wso2.com)
 *
 *  WSO2 LLC. licenses this file to you under the Apache License,
 *  Version 2.0 (the "License"); you may not use this file except
 *  in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing,
 *  software distributed under the License is distributed on an
 *  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 *  KIND, either express or implied.  See the License for the
 *  specific language governing permissions and limitations
 *  under the License.
 */

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import type { AgentRunStatus } from "@wso2/ballerina-core";

// Same reason as index.test.tsx: the core barrel re-exports ESM-only LS
// transport modules jest cannot load.
jest.mock("@wso2/ballerina-core", () => ({
    MACHINE_VIEW: {},
    SHARED_COMMANDS: { OPEN_AI_PANEL: "ballerina.open.ai.panel" },
    // The orb resolves its product name through these; mirrors index.test.tsx.
    ProductMode: { BALLERINA: "ballerina", INTEGRATOR: "integrator" },
    seededProductMode: (): undefined => undefined,
    assistantName: () => "WSO2 Integrator Copilot",
    assistantTagline: () => "Your AI pair programmer for integration development",
}));

let mockRpcClient: unknown;
const mockSendSuggestionTelemetry = jest.fn();
jest.mock("@wso2/ballerina-rpc-client", () => ({
    useRpcContext: () => ({ rpcClient: mockRpcClient }),
}));

jest.mock("./CopilotOrb", () => ({ CopilotOrb: (): null => null }));

let miniChatMounts = 0;
jest.mock("./MiniChat", () => ({
    MiniChat: (): null => {
        miniChatMounts += 1;
        return null;
    },
}));

import { AgentStatusOrb } from "./index";
import { __resetAgentRunStatusStoreForTests } from "./shared";
import {
    __resetSuggestionStoreForTests,
    clearSuggestion,
    offerSuggestion,
} from "./suggestions";
import { createMiniChatPrompt } from "./promptHandoff";
import { RUN_FAILURE_OFFER_DELAY_MS } from "./runFailureOffer";

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IDLE = { state: "idle", aiPanelOpen: false, timestamp: 0 } as AgentRunStatus;

const OFFER = {
    kind: "data-mapper-unmapped" as const,
    text: "7 of 9 fields are still unmapped.",
    action: "Map them for me",
    prompt: createMiniChatPrompt("Map the 7 unmapped output fields."),
};

describe("orb proactive suggestion", () => {
    let container: HTMLDivElement;
    let root: Root;
    let notify: (status: AgentRunStatus) => void;

    const bubble = () => container.querySelector('[data-testid="orb-suggestion"]') as HTMLElement | null;
    /** The pill the suggestion now shares with the invite, and its fade state. */
    const pill = () => container.querySelector('[data-testid="invite-shell"]') as HTMLElement | null;
    const pillShown = () => {
        const box = pill();
        if (!box) return false;
        const style = getComputedStyle(box);
        return style.opacity === "1" && style.visibility === "visible";
    };
    const accept = () =>
        Array.from(container.querySelectorAll("button")).find(
            (button) => button.textContent === OFFER.action
        ) as HTMLButtonElement | undefined;
    const dismiss = () =>
        Array.from(container.querySelectorAll("button")).find(
            (button) => button.textContent === "Not now"
        ) as HTMLButtonElement | undefined;
    const click = (element: HTMLElement) =>
        act(() => {
            element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

    beforeEach(() => {
        __resetAgentRunStatusStoreForTests();
        __resetSuggestionStoreForTests();
        miniChatMounts = 0;
        let pushed: ((status: AgentRunStatus) => void) | undefined;
        mockRpcClient = {
            getCommonRpcClient: () => ({
                getAgentRunStatus: jest.fn().mockResolvedValue(undefined),
                getCopilotOrbTheme: jest.fn().mockResolvedValue("animated"),
                executeCommand: jest.fn().mockResolvedValue(undefined),
                sendCopilotSuggestionTelemetry: mockSendSuggestionTelemetry,
            }),
            getAiPanelRpcClient: () => ({ isUserAuthenticated: () => Promise.resolve(true) }),
            onAgentRunStatusChanged: jest.fn((cb: (status: AgentRunStatus) => void) => {
                pushed = cb;
            }),
        };
        notify = (status) => act(() => pushed!(status));
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<AgentStatusOrb />));
        notify(IDLE);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("shows nothing until something is offered", () => {
        expect(bubble()).toBeNull();
    });

    it("shows the offer without needing a hover", () => {
        // The pill is hidden until the pointer arrives; an offer has to open it.
        expect(pillShown()).toBe(false);
        act(() => {
            offerSuggestion(OFFER);
        });
        expect(pillShown()).toBe(true);
        expect(bubble()).not.toBeNull();
        expect(bubble()!.textContent).toContain("7 of 9 fields are still unmapped.");
        expect(accept()).toBeDefined();
    });

    it("gives the pill back to the invite once the offer is gone", () => {
        act(() => {
            offerSuggestion(OFFER);
        });
        expect(container.querySelector('input[placeholder="How can I help?"]')).toBeNull();
        act(() => clearSuggestion(OFFER.kind, true));
        expect(bubble()).toBeNull();
        expect(pillShown()).toBe(false);
        expect(container.querySelector('input[placeholder="How can I help?"]')).not.toBeNull();
    });

    it("opens the mini chat when the offer is taken up", () => {
        act(() => {
            offerSuggestion(OFFER);
        });
        expect(miniChatMounts).toBe(0);
        click(accept()!);
        expect(miniChatMounts).toBeGreaterThan(0);
        expect(bubble()).toBeNull();
    });

    it("stays quiet for the rest of the session once dismissed", () => {
        act(() => {
            offerSuggestion(OFFER);
        });
        click(dismiss()!);
        expect(bubble()).toBeNull();
        act(() => {
            offerSuggestion(OFFER);
        });
        expect(bubble()).toBeNull();
    });

    it("dismisses the offer on Escape, the same as Not now", () => {
        act(() => {
            offerSuggestion(OFFER);
        });
        act(() => {
            bubble()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(bubble()).toBeNull();
        act(() => {
            offerSuggestion(OFFER);
        });
        expect(bubble()).toBeNull();
    });

    it("can be offered again after merely being withdrawn", () => {
        act(() => {
            offerSuggestion(OFFER);
        });
        act(() => clearSuggestion(OFFER.kind));
        expect(bubble()).toBeNull();
        act(() => {
            offerSuggestion(OFFER);
        });
        expect(bubble()).not.toBeNull();
    });

    it("does not let a second offer talk over the first", () => {
        act(() => {
            offerSuggestion(OFFER);
        });
        let accepted = true;
        act(() => {
            accepted = offerSuggestion({ ...OFFER, text: "something else" });
        });
        expect(accepted).toBe(false);
        expect(bubble()!.textContent).toContain("7 of 9 fields");
    });

    it("withdraws the offer when the orb hides behind the panel", () => {
        act(() => {
            offerSuggestion(OFFER);
        });
        notify({ ...IDLE, aiPanelOpen: true } as AgentRunStatus);
        expect(bubble()).toBeNull();
        // Hiding is not a refusal, so the same offer can be made again.
        notify(IDLE);
        act(() => {
            offerSuggestion(OFFER);
        });
        expect(bubble()).not.toBeNull();
    });

    it("shows no offer while proactive suggestions are turned off, and shows it once turned back on", () => {
        notify({ ...IDLE, suggestionsOff: true } as AgentRunStatus);
        act(() => {
            offerSuggestion(OFFER);
        });
        expect(bubble()).toBeNull();
        notify(IDLE);
        expect(bubble()).not.toBeNull();
    });

    it("reports each offer once when shown, and how it was answered", () => {
        mockSendSuggestionTelemetry.mockClear();
        act(() => {
            offerSuggestion(OFFER);
        });
        // Dropping out of sight during a run and coming back is still the same offer.
        notify({ ...IDLE, state: "running" } as AgentRunStatus);
        notify(IDLE);
        click(dismiss()!);
        expect(mockSendSuggestionTelemetry.mock.calls.map(([event]) => event)).toEqual([
            { kind: OFFER.kind, outcome: "shown" },
            { kind: OFFER.kind, outcome: "dismissed" },
        ]);
    });

    it("reports an offer taken up", () => {
        mockSendSuggestionTelemetry.mockClear();
        act(() => {
            offerSuggestion(OFFER);
        });
        click(accept()!);
        expect(mockSendSuggestionTelemetry).toHaveBeenLastCalledWith({ kind: OFFER.kind, outcome: "accepted" });
    });

    describe("failed integration run", () => {
        const FAILED = {
            ...IDLE,
            runFailure: { integration: "orders_service", projectPath: "/work/orders_service", exitCode: 1 },
        } as AgentRunStatus;

        afterEach(() => jest.useRealTimers());

        it("offers to investigate once the extension reports it, and withdraws it when cleared", async () => {
            // Let the sign-in lookup settle before the clock is faked.
            await act(async () => {});
            jest.useFakeTimers();
            notify(FAILED);
            expect(bubble()).toBeNull();
            act(() => jest.advanceTimersByTime(RUN_FAILURE_OFFER_DELAY_MS));
            expect(bubble()!.textContent).toContain("orders_service stopped with an error.");
            notify(IDLE);
            expect(bubble()).toBeNull();
        });
    });

    describe("priority between kinds", () => {
        const ERRORS = { ...OFFER, kind: "flow-errors" as const, text: "This flow has 2 errors." };

        it("lets a more important offer replace a less important one", () => {
            act(() => {
                offerSuggestion(OFFER);
            });
            let offered = false;
            act(() => {
                offered = offerSuggestion(ERRORS);
            });
            expect(offered).toBe(true);
            expect(bubble()!.textContent).toContain("2 errors");
        });

        it("keeps a more important offer up when a less important one arrives", () => {
            act(() => {
                offerSuggestion(ERRORS);
            });
            let offered = true;
            act(() => {
                offered = offerSuggestion(OFFER);
            });
            expect(offered).toBe(false);
            expect(bubble()!.textContent).toContain("2 errors");
        });
    });

    it("can make a different offer straight after one is taken up", () => {
        act(() => {
            offerSuggestion(OFFER);
        });
        click(accept()!);
        let offered = false;
        act(() => {
            offered = offerSuggestion({ ...OFFER, kind: "flow-errors", text: "I found 1 error in this flow." });
        });
        expect(offered).toBe(true);
    });
});
