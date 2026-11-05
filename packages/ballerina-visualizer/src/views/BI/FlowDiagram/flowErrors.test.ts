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

import type { Flow, FlowNode } from "@wso2/ballerina-core";
import { buildFlowErrorOffer, readFlowErrors } from "./flowErrors";

const error = (message: string) => ({ message, severity: "ERROR" as const });
const warning = (message: string) => ({ message, severity: "WARNING" as const });

const node = (overrides: Partial<FlowNode> = {}): FlowNode =>
    ({ id: "n", metadata: { label: "n" }, codedata: { node: "EXPRESSION" }, ...overrides } as unknown as FlowNode);

const flow = (...nodes: FlowNode[]): Flow => ({ fileName: "main.bal", nodes });

describe("readFlowErrors", () => {
    it("finds nothing on a clean flow or no flow", () => {
        expect(readFlowErrors(flow(node(), node()))).toEqual([]);
        expect(readFlowErrors(undefined)).toEqual([]);
    });

    it("collects errors from nodes, properties, branch properties and nested children", () => {
        const model = flow(
            node({ diagnostics: { hasDiagnostics: true, diagnostics: [error("on the node")] } }),
            node({
                properties: {
                    expression: { diagnostics: { hasDiagnostics: true, diagnostics: [error("on a property")] } },
                } as unknown as FlowNode["properties"],
                branches: [
                    {
                        properties: {
                            condition: { diagnostics: { hasDiagnostics: true, diagnostics: [error("on a branch")] } },
                        },
                        children: [node({ diagnostics: { hasDiagnostics: true, diagnostics: [error("in a child")] } })],
                    },
                ] as unknown as FlowNode["branches"],
            })
        );
        expect(readFlowErrors(model)).toEqual(["on the node", "on a property", "on a branch", "in a child"]);
    });

    it("leaves out warnings and repeats", () => {
        const diagnostics = { hasDiagnostics: true, diagnostics: [error("undefined symbol 'x'"), warning("unused variable")] };
        expect(readFlowErrors(flow(node({ diagnostics }), node({ diagnostics })))).toEqual(["undefined symbol 'x'"]);
    });

    it("skips property diagnostics not flagged as present, as the diagnostics popup does", () => {
        const properties = {
            expression: { diagnostics: { hasDiagnostics: false, diagnostics: [error("stale")] } },
        } as unknown as FlowNode["properties"];
        expect(readFlowErrors(flow(node({ properties })))).toEqual([]);
    });
});

describe("buildFlowErrorOffer", () => {
    it("words a single error in the singular", () => {
        const offer = buildFlowErrorOffer(["undefined symbol 'x'"], "main.bal");
        expect(offer.text).toBe("This flow has an error.");
        expect(offer.action).toBe("Fix it for me");
        expect(offer.prompt.text).toContain("in main.bal");
        expect(offer.prompt.text).toContain("1. undefined symbol 'x'");
        expect(offer.prompt.autoSubmit).toBe(false);
    });

    it("counts several and caps the list in the prompt", () => {
        const messages = Array.from({ length: 25 }, (_, index) => `error ${index + 1}`);
        const offer = buildFlowErrorOffer(messages);
        expect(offer.text).toBe("This flow has 25 errors.");
        expect(offer.action).toBe("Fix them for me");
        expect(offer.prompt.text).toContain("20. error 20");
        expect(offer.prompt.text).not.toContain("21. error 21");
        expect(offer.prompt.text).toContain("(and 5 more)");
    });
});
