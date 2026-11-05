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

import type { Flow, FlowNode, ParentMetadata } from "@wso2/ballerina-core";
import { buildImplementOffer, readEmptyBody } from "./emptyBody";

const start = (data: Partial<ParentMetadata>): FlowNode =>
    ({ id: "start", codedata: { node: "EVENT_START" }, metadata: { label: "Start", data } } as unknown as FlowNode);
const node = (kind: string, branches?: unknown): FlowNode =>
    ({ id: kind, codedata: { node: kind }, branches } as unknown as FlowNode);
const flow = (...nodes: FlowNode[]): Flow => ({ fileName: "main.bal", nodes });

const FUNCTION = { kind: "Function", label: "getName" };
const errorHandler = (body: FlowNode[], onFailure: FlowNode[] = []) =>
    node("ERROR_HANDLER", [
        { label: "Body", codedata: { node: "BODY" }, children: body },
        { label: "On Failure", codedata: { node: "ON_FAILURE" }, children: onFailure },
    ]);

describe("readEmptyBody", () => {
    it("finds a function with nothing after its start node", () => {
        expect(readEmptyBody(flow(start(FUNCTION)))?.label).toBe("getName");
    });

    it("ignores the diagram's empty placeholders", () => {
        expect(readEmptyBody(flow(start(FUNCTION), node("EMPTY")))?.label).toBe("getName");
    });

    it("treats a template's empty do/on-fail as empty, whatever the on-fail holds", () => {
        const model = flow(start(FUNCTION), errorHandler([node("EMPTY")], [node("FUNCTION_CALL"), node("RETURN")]));
        expect(readEmptyBody(model)?.label).toBe("getName");
    });

    it("does not treat a body with code as empty", () => {
        expect(readEmptyBody(flow(start(FUNCTION), node("VARIABLE")))).toBeUndefined();
        expect(readEmptyBody(flow(start(FUNCTION), errorHandler([node("VARIABLE")])))).toBeUndefined();
    });

    it("leaves out agent, workflow and activity bodies, and flows with no start", () => {
        for (const kind of ["AI Chat Agent", "Workflow", "Activity"]) {
            expect(readEmptyBody(flow(start({ kind, label: "x" })))).toBeUndefined();
        }
        expect(readEmptyBody(flow(node("VARIABLE")))).toBeUndefined();
        expect(readEmptyBody(undefined)).toBeUndefined();
    });
});

describe("buildImplementOffer", () => {
    it("names a function and passes its signature to the prompt", () => {
        const offer = buildImplementOffer(
            { kind: "Function", label: "getName", parameters: ["int id"], return: "string?" },
            "main.bal"
        );
        expect(offer.text).toBe("getName has no logic yet.");
        expect(offer.action).toBe("Implement it for me");
        expect(offer.prompt.text).toContain("Implement the function `getName` in main.bal.");
        expect(offer.prompt.text).toContain("Parameters: int id");
        expect(offer.prompt.text).toContain("Returns: string?");
        expect(offer.prompt.autoSubmit).toBe(false);
    });

    it("names a resource by its method and path, with the root path as /", () => {
        expect(buildImplementOffer({ kind: "Resource", label: "orders/[string id]", accessor: "get" }).text).toBe(
            "GET /orders/[string id] has no logic yet."
        );
        expect(buildImplementOffer({ kind: "Resource", label: ".", accessor: "post" }).text).toBe(
            "POST / has no logic yet."
        );
    });

    it("calls a remote function what it is", () => {
        const offer = buildImplementOffer({ kind: "Remote Function", label: "onMessage" });
        expect(offer.prompt.text).toContain("Implement the remote function `onMessage`.");
    });
});
