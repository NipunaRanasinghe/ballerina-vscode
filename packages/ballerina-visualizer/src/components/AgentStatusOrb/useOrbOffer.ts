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

import { useEffect, useRef, useState } from "react";
import { useRpcContext } from "@wso2/ballerina-rpc-client";
import { clearSuggestion, CopilotSuggestion, offerSuggestion, SuggestionKind } from "./shared";

export interface OrbOfferOptions {
    /** The user is mid-task in the view; the offer waits until this clears. */
    busy?: boolean;
    /** How long the offer must stay unchanged before the orb shows it. */
    delayMs?: number;
}

/**
 * The one way a view raises a proactive offer. The view works out what it would
 * offer right now (or null); this decides when the orb actually says it.
 *
 * - It waits `delayMs` with the offer unchanged, and waits while `busy`.
 * - It offers nothing until Copilot is signed in, since the offer could not run.
 * - A changed offer withdraws the old one first, so the orb never describes a
 *   state that is gone. "Changed" means different wording or prompt, so a view
 *   re-rendering the same offer does not restart the wait.
 * - Leaving the view withdraws the offer.
 *
 * Which offer wins when several are raised, the cooldown and dismissals live in
 * the store (`offerSuggestion`), so every trigger gets the same rules.
 */
export function useOrbOffer(
    kind: SuggestionKind,
    offer: CopilotSuggestion | null,
    { busy = false, delayMs = 0 }: OrbOfferOptions = {}
): void {
    const { rpcClient } = useRpcContext();
    const [signedIn, setSignedIn] = useState(false);
    useEffect(() => {
        let active = true;
        rpcClient
            ?.getAiPanelRpcClient()
            .isUserAuthenticated()
            .then((value) => active && setSignedIn(value))
            .catch(() => active && setSignedIn(false));
        return () => {
            active = false;
        };
    }, [rpcClient]);

    const signature = offer ? [offer.text, offer.action, offer.prompt.text].join("\u0000") : "";
    const offerRef = useRef(offer);
    offerRef.current = offer;

    useEffect(() => {
        clearSuggestion(kind);
        if (!signature || busy || !signedIn) {
            return;
        }
        const raise = () => offerRef.current && offerSuggestion(offerRef.current);
        if (delayMs <= 0) {
            raise();
            return;
        }
        const timer = setTimeout(raise, delayMs);
        return () => clearTimeout(timer);
    }, [kind, signature, busy, signedIn, delayMs]);

    useEffect(() => () => clearSuggestion(kind), [kind]);
}
