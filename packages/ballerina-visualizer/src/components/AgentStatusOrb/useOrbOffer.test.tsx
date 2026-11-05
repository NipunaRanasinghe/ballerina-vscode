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

// The core barrel re-exports ESM-only LS transport modules jest cannot load; the
// orb store only needs the view enum from it.
jest.mock("@wso2/ballerina-core", () => ({
    MACHINE_VIEW: new Proxy({}, { get: (_target, key) => key }),
}));
let mockSignedIn = true;
jest.mock("@wso2/ballerina-rpc-client", () => ({
    useRpcContext: () => ({
        rpcClient: { getAiPanelRpcClient: () => ({ isUserAuthenticated: () => Promise.resolve(mockSignedIn) }) },
    }),
}));

import { OrbOfferOptions, useOrbOffer } from "./useOrbOffer";
import {
    __resetSuggestionStoreForTests,
    clearSuggestion,
    CopilotSuggestion,
    subscribeSuggestion,
} from "./shared";
import { createMiniChatPrompt } from "./promptHandoff";

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MAPPING: CopilotSuggestion = {
    kind: "data-mapper-unmapped",
    text: "7 of 9 fields are still unmapped.",
    action: "Map them for me",
    prompt: createMiniChatPrompt("Map the 7 unmapped output fields."),
};

function Host({ offer, options }: { offer: CopilotSuggestion | null; options?: OrbOfferOptions }): null {
    useOrbOffer("data-mapper-unmapped", offer, options);
    return null;
}

describe("useOrbOffer", () => {
    let root: Root;
    let live: CopilotSuggestion | null;
    let unsubscribe: () => void;
    const render = async (offer: CopilotSuggestion | null, options?: OrbOfferOptions) => {
        act(() => root.render(<Host offer={offer} options={options} />));
        await act(async () => {});
    };

    beforeEach(() => {
        mockSignedIn = true;
        __resetSuggestionStoreForTests();
        live = null;
        unsubscribe = subscribeSuggestion((suggestion) => (live = suggestion));
        root = createRoot(document.createElement("div"));
    });

    afterEach(() => {
        act(() => root.unmount());
        unsubscribe();
    });

    it("offers straight away with no delay", async () => {
        await render(MAPPING);
        expect(live).toBe(MAPPING);
    });

    it("offers nothing while Copilot is signed out", async () => {
        mockSignedIn = false;
        await render(MAPPING);
        expect(live).toBeNull();
    });

    it("does not raise a dismissed offer again when the view re-renders it", async () => {
        await render(MAPPING);
        act(() => clearSuggestion(MAPPING.kind, "dismissed"));
        await render({ ...MAPPING });
        expect(live).toBeNull();
    });

    it("withdraws the offer when the view stops making it", async () => {
        await render(MAPPING);
        await render(null);
        expect(live).toBeNull();
    });
});
