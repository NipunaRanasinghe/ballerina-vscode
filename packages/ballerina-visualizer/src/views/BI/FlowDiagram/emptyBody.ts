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
import { createMiniChatPrompt } from "../../../components/AgentStatusOrb/promptHandoff";
import type { CopilotSuggestion } from "../../../components/AgentStatusOrb/suggestions";

/**
 * Kinds the offer is made for, as the language server names them. Agent, workflow
 * and activity bodies are generated or wired up by their own editors.
 */
const IMPLEMENTABLE_KINDS: Record<string, string> = {
    Function: "function",
    "Remote Function": "remote function",
    Resource: "resource",
};

/** The diagram's own placeholder for an empty slot; it is not code. */
const isPlaceholder = (node: FlowNode) => node.codedata?.node === "EMPTY" || node.codedata?.node === "DRAFT";

function hasNoCode(nodes: FlowNode[] | undefined): boolean {
    return (nodes ?? []).every(isPlaceholder);
}

/**
 * The function or resource this flow belongs to, when its body has no code yet.
 *
 * Empty means nothing after the start node, or only the `do { } on fail` wrapper
 * some templates generate with nothing in its Body. Whatever the on-fail branch
 * holds is template code (logging and returning the error), not the user's work.
 */
export function readEmptyBody(model: Flow | null | undefined): ParentMetadata | undefined {
    const start = model?.nodes?.find((node) => node.codedata?.node === "EVENT_START");
    const parent = start?.metadata?.data as ParentMetadata | undefined;
    if (!parent?.label || !IMPLEMENTABLE_KINDS[parent.kind]) {
        return undefined;
    }
    const rest = model.nodes.filter((node) => node !== start && !isPlaceholder(node));
    if (rest.length === 0) {
        return parent;
    }
    if (rest.length === 1 && rest[0].codedata?.node === "ERROR_HANDLER") {
        const body = rest[0].branches?.find((branch) => branch.codedata?.node === "BODY");
        if (body && hasNoCode(body.children)) {
            return parent;
        }
    }
    return undefined;
}

/**
 * How the offer names what is empty: `GET /orders` for a resource, its name
 * otherwise. The language server gives a resource's path without the leading
 * slash, and `.` for the service root.
 */
function describe(parent: ParentMetadata): string {
    if (parent.accessor) {
        const path = parent.label === "." ? "/" : `/${parent.label}`;
        return `${parent.accessor.toUpperCase()} ${path}`;
    }
    return parent.label;
}

/** The offer to implement an empty `parent`. */
export function buildImplementOffer(parent: ParentMetadata, fileName?: string): CopilotSuggestion {
    const name = describe(parent);
    const what = IMPLEMENTABLE_KINDS[parent.kind];
    const signature = [
        parent.parameters?.length ? `Parameters: ${parent.parameters.join(", ")}` : undefined,
        parent.return ? `Returns: ${parent.return}` : undefined,
    ].filter(Boolean);
    const prompt = [
        `Implement the ${what} \`${name}\`${fileName ? ` in ${fileName}` : ""}. Its body is empty.`,
        ...signature,
        "",
        "Keep the existing signature. Work out what it should do from its name, signature and how the rest of the project uses it, and ask me if that is unclear.",
    ].join("\n");
    return {
        kind: "empty-body",
        // The pill shows plain text, so the name goes in bare; the prompt is markdown.
        text: `${name} has no logic yet.`,
        action: "Implement it for me",
        // Left unsent, like every offer: the user can say what it should do before it runs.
        prompt: createMiniChatPrompt(prompt),
    };
}
