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

import { useMemo } from "react";
import type { Flow } from "@wso2/ballerina-core";
import { useOrbOffer } from "../../../../components/AgentStatusOrb/useOrbOffer";
import { buildFlowErrorOffer, readFlowErrors } from "../flowErrors";
import { buildImplementOffer, readEmptyBody } from "../emptyBody";

/**
 * Errors have to sit unchanged this long before the orb offers to fix them. A
 * node the user is still filling in reports errors too, and they clear on their
 * own a few seconds later.
 */
export const FLOW_ERROR_OFFER_DELAY_MS = 10 * 1000;
/**
 * An empty body waits longer: someone who has just opened a new function is
 * usually about to add its first node themselves.
 */
export const EMPTY_BODY_OFFER_DELAY_MS = 15 * 1000;

/**
 * The flow diagram's offers: implement an empty body, or fix the flow's errors.
 * `busy` covers anything that means the user is still at work on the canvas (an
 * open side panel, a draft node, a save in flight).
 *
 * An empty body takes the place of the errors offer. Its errors (a missing
 * return, say) are what implementing it fixes, so offering both would ask for
 * the same work twice.
 */
export function useFlowOffers(model: Flow | undefined, busy: boolean): void {
    const implementOffer = useMemo(() => {
        const parent = readEmptyBody(model);
        return parent ? buildImplementOffer(parent, model?.fileName) : null;
    }, [model]);
    const errorOffer = useMemo(() => {
        const messages = implementOffer ? [] : readFlowErrors(model);
        return messages.length > 0 ? buildFlowErrorOffer(messages, model?.fileName) : null;
    }, [model, implementOffer]);
    useOrbOffer("empty-body", implementOffer, { busy, delayMs: EMPTY_BODY_OFFER_DELAY_MS });
    useOrbOffer("flow-errors", errorOffer, { busy, delayMs: FLOW_ERROR_OFFER_DELAY_MS });
}
