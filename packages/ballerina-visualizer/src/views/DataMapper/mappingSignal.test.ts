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

// Importing a value from the package root pulls in its language-server entry
// point, which ships as ESM that jest does not transform. Only TypeKind is
// needed here, and its members are the type names the model already carries.
jest.mock("@wso2/ballerina-core", () => ({
    TypeKind: { Record: "record", Array: "array", String: "string", Int: "int" },
}));

import { type ExpandedDMModel, type IOType, type Mapping, TypeKind } from "@wso2/ballerina-core";
import { MIN_UNMAPPED_TARGETS, readMappingSignal } from "./mappingSignal";

function leaf(id: string, kind: TypeKind = TypeKind.String): IOType {
    return { id, kind, name: id.split(".").pop() };
}

function record(id: string, fields: IOType[], extra: Partial<IOType> = {}): IOType {
    return { id, kind: TypeKind.Record, name: id.split(".").pop(), fields, ...extra };
}

function model(output: IOType, mappings: Mapping[] = [], overrides: Partial<ExpandedDMModel> = {}): ExpandedDMModel {
    return {
        inputs: [leaf("src")],
        output,
        mappings,
        source: "",
        rootViewId: "root",
        ...overrides,
    } as ExpandedDMModel;
}

const mapTo = (output: string): Mapping => ({ output, expression: "src.x", inputs: ["src.x"] });

describe("data mapper mapping signal", () => {
    it("reports nothing for a missing model", () => {
        expect(readMappingSignal(null).shouldOffer).toBe(false);
        expect(readMappingSignal(undefined).totalTargets).toBe(0);
    });

    it("offers when an untouched output has enough fields to be worth filling", () => {
        const out = record("out", [leaf("out.a"), leaf("out.b"), leaf("out.c")]);
        const signal = readMappingSignal(model(out));
        expect(signal.totalTargets).toBe(3);
        expect(signal.unmappedTargets).toBe(3);
        expect(signal.shouldOffer).toBe(true);
    });

    it("stays quiet when fewer fields are outstanding than the threshold", () => {
        const out = record("out", [leaf("out.a"), leaf("out.b")]);
        expect(readMappingSignal(model(out)).unmappedTargets).toBeLessThan(MIN_UNMAPPED_TARGETS);
        expect(readMappingSignal(model(out)).shouldOffer).toBe(false);
    });

    it("counts a record's leaves rather than the record itself", () => {
        const out = record("out", [record("out.name", [leaf("out.name.first"), leaf("out.name.last")]), leaf("out.age")]);
        const signal = readMappingSignal(model(out));
        expect(signal.totalTargets).toBe(3);
    });

    it("treats a record mapped as a whole as covering its fields", () => {
        const out = record("out", [
            record("out.name", [leaf("out.name.first"), leaf("out.name.last")]),
            leaf("out.age"),
            leaf("out.city"),
        ]);
        const signal = readMappingSignal(model(out, [mapTo("out.name")]));
        expect(signal.totalTargets).toBe(4);
        expect(signal.unmappedTargets).toBe(2);
        expect(signal.shouldOffer).toBe(false);
    });

    it("matches mapped ids whose field names arrived quoted", () => {
        const out = record("out", [leaf('out."order-id"'), leaf("out.b"), leaf("out.c")]);
        const signal = readMappingSignal(model(out, [mapTo("out.order-id")]));
        expect(signal.unmappedTargets).toBe(2);
    });

    it("treats an array as one target instead of descending into its members", () => {
        const items = leaf("out.items", TypeKind.Array);
        items.member = leaf("out.items.0");
        const out = record("out", [items, leaf("out.a"), leaf("out.b")]);
        const signal = readMappingSignal(model(out));
        expect(signal.totalTargets).toBe(3);
    });

    it("stays quiet when there is nothing to map from", () => {
        const out = record("out", [leaf("out.a"), leaf("out.b"), leaf("out.c")]);
        const signal = readMappingSignal(model(out, [], { inputs: [] }));
        expect(signal.hasInputs).toBe(false);
        expect(signal.shouldOffer).toBe(false);
    });

    it("stays quiet when the model reports the output type as unusable", () => {
        const out = record("out", [leaf("out.a"), leaf("out.b"), leaf("out.c")]);
        const signal = readMappingSignal(model(out, [], { hasInvalidOutput: true }));
        expect(signal.unmappedTargets).toBe(3);
        expect(signal.shouldOffer).toBe(false);
    });

    it("stops at a record flagged as recursive instead of walking it", () => {
        const node = record("out.node", [leaf("out.node.value")], { isRecursive: true });
        const out = record("out", [node, leaf("out.a"), leaf("out.b")]);
        const signal = readMappingSignal(model(out));
        expect(signal.totalTargets).toBe(3);
    });

    it("stops at the depth cap when a type nests without a recursion flag", () => {
        let deep = leaf("out" + ".f".repeat(12));
        for (let depth = 11; depth >= 0; depth--) {
            deep = record("out" + ".f".repeat(depth), [deep]);
        }
        expect(() => readMappingSignal(model(deep))).not.toThrow();
        expect(readMappingSignal(model(deep)).totalTargets).toBe(1);
    });
});
