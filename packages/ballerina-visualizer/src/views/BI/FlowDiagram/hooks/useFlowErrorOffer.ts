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

import { useEffect, useMemo, useRef } from "react";
import type { Flow } from "@wso2/ballerina-core";
import { clearSuggestion, offerSuggestion } from "../../../../components/AgentStatusOrb/shared";
import { buildFlowErrorOffer, readFlowErrors } from "../flowErrors";

/**
 * Errors have to sit unchanged this long before the orb offers to fix them. A
 * node the user is still filling in reports errors too, and they clear on their
 * own a few seconds later.
 */
export const FLOW_ERROR_OFFER_DELAY_MS = 10 * 1000;
/**
 * Offers to fix the flow's errors once they have settled. `busy` covers anything
 * that means the user is still at work on the canvas (an open side panel, a draft
 * node, a save in flight); the offer waits for it to end. Any change to the set of
 * errors withdraws the current offer, so it never describes errors that are gone.
 */
export function useFlowErrorOffer(model: Flow | undefined, busy: boolean, signedIn: boolean): void {
    const messages = useMemo(() => readFlowErrors(model), [model]);
    // A refetch hands over a new model with the same errors; keying on the text
    // keeps that from restarting the wait.
    const signature = messages.join("\u0000");
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const fileName = model?.fileName;

    useEffect(() => {
        clearSuggestion("flow-errors");
        if (!signature || busy || !signedIn) {
            return;
        }
        const timer = setTimeout(
            () => offerSuggestion(buildFlowErrorOffer(messagesRef.current, fileName)),
            FLOW_ERROR_OFFER_DELAY_MS
        );
        return () => clearTimeout(timer);
    }, [signature, busy, signedIn, fileName]);

    // The offer belongs to this diagram; leaving it would point at a flow no longer on screen.
    useEffect(() => () => clearSuggestion("flow-errors"), []);
}
