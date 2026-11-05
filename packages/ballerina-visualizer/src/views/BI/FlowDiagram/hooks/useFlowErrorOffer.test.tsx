/**
 * Copyright (c) 2026, WSO2 LLC. (http://www.wso2.org)
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

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import type { Flow, FlowNode } from "@wso2/ballerina-core";

// The core barrel re-exports ESM-only LS transport modules jest cannot load; the
// orb store only needs the view enum from it.
jest.mock("@wso2/ballerina-core", () => ({
    MACHINE_VIEW: new Proxy({}, { get: (_target, key) => key }),
}));
jest.mock("@wso2/ballerina-rpc-client", () => ({ useRpcContext: (): undefined => undefined }));

import { FLOW_ERROR_OFFER_DELAY_MS, useFlowErrorOffer } from "./useFlowErrorOffer";
import {
    __resetSuggestionStoreForTests,
    CopilotSuggestion,
    subscribeSuggestion,
} from "../../../../components/AgentStatusOrb/shared";

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const withErrors = (...messages: string[]): Flow => ({
    fileName: "main.bal",
    nodes: [
        {
            id: "n",
            diagnostics: { hasDiagnostics: true, diagnostics: messages.map((message) => ({ message, severity: "ERROR" })) },
        } as unknown as FlowNode,
    ],
});

function Host({ model, busy = false, signedIn = true }: { model?: Flow; busy?: boolean; signedIn?: boolean }): null {
    useFlowErrorOffer(model, busy, signedIn);
    return null;
}

describe("useFlowErrorOffer", () => {
    let container: HTMLDivElement;
    let root: Root;
    let offer: CopilotSuggestion | null;
    let unsubscribe: () => void;
    const render = (props: React.ComponentProps<typeof Host>) => act(() => root.render(<Host {...props} />));
    const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms));

    beforeEach(() => {
        jest.useFakeTimers();
        __resetSuggestionStoreForTests();
        offer = null;
        unsubscribe = subscribeSuggestion((suggestion) => (offer = suggestion));
        container = document.createElement("div");
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        unsubscribe();
        jest.useRealTimers();
    });

    it("offers once the errors have stayed put for the delay", () => {
        render({ model: withErrors("undefined symbol 'x'") });
        wait(FLOW_ERROR_OFFER_DELAY_MS - 1);
        expect(offer).toBeNull();
        wait(1);
        expect(offer?.kind).toBe("flow-errors");
        expect(offer?.text).toBe("This flow has an error.");
    });

    it("does not restart the wait when a refetch brings the same errors", () => {
        render({ model: withErrors("a") });
        wait(FLOW_ERROR_OFFER_DELAY_MS / 2);
        render({ model: withErrors("a") });
        wait(FLOW_ERROR_OFFER_DELAY_MS / 2);
        expect(offer).not.toBeNull();
    });

    it("withdraws the offer when the errors change, and offers the new set after the delay", () => {
        render({ model: withErrors("a") });
        wait(FLOW_ERROR_OFFER_DELAY_MS);
        render({ model: withErrors("a", "b") });
        expect(offer).toBeNull();
        wait(FLOW_ERROR_OFFER_DELAY_MS);
        expect(offer?.text).toBe("This flow has 2 errors.");
    });

    it("withdraws the offer once the errors are fixed", () => {
        render({ model: withErrors("a") });
        wait(FLOW_ERROR_OFFER_DELAY_MS);
        render({ model: withErrors() });
        expect(offer).toBeNull();
    });

    it("waits while the user is mid-edit and when Copilot is not signed in", () => {
        render({ model: withErrors("a"), busy: true });
        wait(FLOW_ERROR_OFFER_DELAY_MS);
        expect(offer).toBeNull();
        render({ model: withErrors("a"), signedIn: false });
        wait(FLOW_ERROR_OFFER_DELAY_MS);
        expect(offer).toBeNull();
        render({ model: withErrors("a") });
        wait(FLOW_ERROR_OFFER_DELAY_MS);
        expect(offer).not.toBeNull();
    });

    it("withdraws the offer when the diagram closes", () => {
        render({ model: withErrors("a") });
        wait(FLOW_ERROR_OFFER_DELAY_MS);
        act(() => root.render(<></>));
        expect(offer).toBeNull();
    });
});
