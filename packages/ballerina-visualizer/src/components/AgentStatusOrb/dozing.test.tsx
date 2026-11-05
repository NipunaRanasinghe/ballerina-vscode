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
import type { AgentRunStatus, MACHINE_VIEW } from "@wso2/ballerina-core";

// Same reason as index.test.tsx: the core barrel re-exports ESM-only LS
// transport modules jest cannot load. Each view's value is its own name, so the
// view lists in shared.ts resolve to names this file can check.
jest.mock("@wso2/ballerina-core", () => ({
    MACHINE_VIEW: new Proxy({}, { get: (_target, key) => key }),
    SHARED_COMMANDS: { OPEN_AI_PANEL: "ballerina.open.ai.panel" },
    ProductMode: { BALLERINA: "ballerina", INTEGRATOR: "integrator" },
    seededProductMode: (): undefined => undefined,
    assistantName: () => "WSO2 Integrator Copilot",
    assistantTagline: () => "Your AI pair programmer for integration development",
}));

let mockRpcClient: unknown;
jest.mock("@wso2/ballerina-rpc-client", () => ({
    useRpcContext: () => ({ rpcClient: mockRpcClient }),
}));

let mockOrbProps: Record<string, unknown> | undefined;
jest.mock("./CopilotOrb", () => ({
    CopilotOrb: (props: Record<string, unknown>): null => {
        mockOrbProps = props;
        return null;
    },
}));

let mockMiniMounts = 0;
jest.mock("./MiniChat", () => ({
    MiniChat: (): null => {
        mockMiniMounts++;
        return null;
    },
}));

import { AgentStatusOrb } from "./index";
import {
    __resetAgentRunStatusStoreForTests,
    __resetSuggestionStoreForTests,
    offerSuggestion,
    viewHidesAgentStatusOrb,
} from "./shared";
import { createMiniChatPrompt } from "./promptHandoff";

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const view = (name: string) => name as unknown as MACHINE_VIEW;

describe("which views show the orb", () => {
    it("shows it on design views, forms, wizards and config pages", () => {
        for (const name of ["BIDiagram", "DataMapper", "BIFunctionForm", "AddConnectionWizard", "ViewConfigVariables"]) {
            expect(viewHidesAgentStatusOrb(view(name))).toBe(false);
        }
    });

    it("hides it on setup pages, Copilot's own views and anything unlisted", () => {
        // An unlisted view must opt in, so a view added later never inherits the overlay.
        for (const name of ["BIWelcome", "SetupView", "ReviewMode", "SomeViewAddedLater"]) {
            expect(viewHidesAgentStatusOrb(view(name))).toBe(true);
        }
        expect(viewHidesAgentStatusOrb(undefined)).toBe(true);
    });
});

describe("dozing orb", () => {
    const IDLE = { state: "idle", aiPanelOpen: false, timestamp: 0 } as AgentRunStatus;
    const DOZE_AFTER_MS = 2 * 60 * 1000;

    let container: HTMLDivElement;
    let root: Root;
    let notify: (status: AgentRunStatus) => void;

    const orbButton = () => container.querySelector("button[aria-label]") as HTMLButtonElement;
    const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms));

    beforeEach(async () => {
        jest.useFakeTimers();
        __resetAgentRunStatusStoreForTests();
        __resetSuggestionStoreForTests();
        mockOrbProps = undefined;
        mockMiniMounts = 0;
        let pushed: ((status: AgentRunStatus) => void) | undefined;
        mockRpcClient = {
            getCommonRpcClient: () => ({
                getAgentRunStatus: jest.fn().mockResolvedValue(undefined),
                getCopilotOrbTheme: jest.fn().mockResolvedValue("animated"),
                executeCommand: jest.fn().mockResolvedValue(undefined),
            }),
            onAgentRunStatusChanged: jest.fn((cb: (status: AgentRunStatus) => void) => {
                pushed = cb;
            }),
        };
        notify = (status) => act(() => pushed!(status));
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<AgentStatusOrb />));
        // Let the mount's async lookups (product mode, theme) settle inside act.
        await act(async () => {});
        notify(IDLE);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        jest.useRealTimers();
    });

    it("stays awake while the user is around and dozes once they have been away", () => {
        wait(DOZE_AFTER_MS - 1);
        expect(mockOrbProps!.dozing).toBe(false);
        wait(1);
        expect(mockOrbProps!.dozing).toBe(true);
    });

    it("wakes on any input in the webview and restarts the countdown", () => {
        wait(DOZE_AFTER_MS);
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown"));
        });
        expect(mockOrbProps!.dozing).toBe(false);
        wait(DOZE_AFTER_MS);
        expect(mockOrbProps!.dozing).toBe(true);
    });

    it("wakes while the orb has keyboard focus", () => {
        wait(DOZE_AFTER_MS);
        act(() => orbButton().focus());
        expect(mockOrbProps!.dozing).toBe(false);
    });

    it("wakes for a suggestion", () => {
        wait(DOZE_AFTER_MS);
        act(() => {
            offerSuggestion({
                kind: "data-mapper-unmapped",
                text: "7 of 9 fields are still unmapped.",
                action: "Map them for me",
                prompt: createMiniChatPrompt("Map the 7 unmapped output fields."),
            });
        });
        expect(mockOrbProps!.noticing).toBe(true);
        expect(mockOrbProps!.dozing).toBe(false);
    });

    it("wakes for a run", () => {
        wait(DOZE_AFTER_MS);
        notify({ ...IDLE, state: "running" } as AgentRunStatus);
        expect(mockOrbProps!.dozing).toBe(false);
    });

    it("still opens the mini chat on a click while dozing", () => {
        wait(DOZE_AFTER_MS);
        act(() => orbButton().click());
        expect(mockMiniMounts).toBeGreaterThan(0);
        expect(mockOrbProps!.dozing).toBe(false);
    });
});
