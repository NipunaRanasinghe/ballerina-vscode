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

import { type ExpandedDMModel, type IOType, TypeKind } from "@wso2/ballerina-core";

/**
 * Below this, dragging the remaining fields by hand is quicker than describing
 * them, so there is nothing worth offering to do.
 */
export const MIN_UNMAPPED_TARGETS = 3;

/**
 * Stops the walk on output types that nest without end. `isRecursive` already
 * marks most of them, but a type can also recurse through a chain of records
 * that individually carry no flag.
 */
const MAX_OUTPUT_DEPTH = 8;

export interface DataMapperMappingSignal {
    /** Output fields that can take a mapping of their own. */
    totalTargets: number;
    /** Of those, the ones neither mapped directly nor covered by a mapped ancestor. */
    unmappedTargets: number;
    /** Whether the model offers anything to map from. */
    hasInputs: boolean;
    /** Whether enough unmapped work remains to be worth offering to do it. */
    shouldOffer: boolean;
}

const EMPTY_SIGNAL: DataMapperMappingSignal = {
    totalTargets: 0,
    unmappedTargets: 0,
    hasInputs: false,
    shouldOffer: false,
};

/**
 * Field ids reach the model quoted when the Ballerina field name needs escaping.
 * `findMappingByOutput` in the data mapper compares both forms; stripping quotes
 * on both sides here does the same job with one representation.
 */
function normalizeId(id: string): string {
    return id.replaceAll('"', "");
}

/**
 * Collects the output ids a mapping can be written to.
 *
 * A record contributes its fields rather than itself, because the mapper draws a
 * link per leaf. An array contributes only itself: its elements are filled by one
 * query expression over the whole array, so its members are not separate targets.
 */
function collectTargets(node: IOType | undefined, depth: number, out: string[]): void {
    if (!node?.id) {
        return;
    }
    const fields = node.kind === TypeKind.Array ? undefined : node.fields;
    const descend = fields?.length && !node.isRecursive && depth < MAX_OUTPUT_DEPTH;
    if (!descend) {
        out.push(normalizeId(node.id));
        return;
    }
    for (const field of fields) {
        collectTargets(field, depth + 1, out);
    }
}

/**
 * True when the target, or a record above it, already carries a mapping. A record
 * mapped as a whole leaves its fields with no link of their own, so counting only
 * direct hits would report those fields as outstanding work.
 */
function isCovered(targetId: string, mapped: Set<string>): boolean {
    if (mapped.has(targetId)) {
        return true;
    }
    for (let cut = targetId.lastIndexOf("."); cut > 0; cut = targetId.lastIndexOf(".", cut - 1)) {
        if (mapped.has(targetId.slice(0, cut))) {
            return true;
        }
    }
    return false;
}

/**
 * How much of the data mapper's output is still unmapped.
 *
 * This reads the model only. Whether the companion actually speaks is a separate
 * decision -- it also depends on when the model settled and on what the user has
 * already been offered -- so this reports the counts alongside `shouldOffer`.
 */
export function readMappingSignal(model: ExpandedDMModel | null | undefined): DataMapperMappingSignal {
    if (!model?.output) {
        return EMPTY_SIGNAL;
    }
    const targets: string[] = [];
    collectTargets(model.output, 0, targets);
    const mapped = new Set((model.mappings ?? []).map((mapping) => normalizeId(mapping.output)));
    const unmappedTargets = targets.filter((id) => !isCovered(id, mapped)).length;
    const hasInputs = (model.inputs ?? []).length > 0;
    return {
        totalTargets: targets.length,
        unmappedTargets,
        hasInputs,
        // An unusable output type is reported by the model rather than inferred;
        // offering to fill it in would produce mappings that cannot compile.
        shouldOffer: hasInputs && !model.hasInvalidOutput && unmappedTargets >= MIN_UNMAPPED_TARGETS,
    };
}
