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

import { buildRunFailureOffer } from "./runFailureOffer";

describe("buildRunFailureOffer", () => {
    const offer = buildRunFailureOffer({ integration: "orders_service", projectPath: "/work/orders_service", exitCode: 1 });

    it("names the integration in plain text, in the orb's voice", () => {
        expect(offer.kind).toBe("run-failure");
        expect(offer.text).toBe("orders_service stopped with an error. I can find out why.");
        expect(offer.action).toBe("Investigate");
    });

    it("tells Copilot where it failed and to reproduce it, and runs straight away", () => {
        expect(offer.prompt.text).toContain("`orders_service` (/work/orders_service)");
        expect(offer.prompt.text).toContain("exited with code 1");
        expect(offer.prompt.text).toContain("Run it to see the output");
        expect(offer.prompt.autoSubmit).toBe(true);
        expect(offer.prompt.planMode).toBe(false);
    });
});
