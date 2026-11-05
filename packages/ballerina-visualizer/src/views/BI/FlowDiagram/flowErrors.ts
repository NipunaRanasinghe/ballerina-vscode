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

import type { Flow, FlowNode, NodeProperties } from "@wso2/ballerina-core";
import { createMiniChatPrompt } from "../../../components/AgentStatusOrb/promptHandoff";

/**
 * The distinct error messages on a flow, in the order its nodes appear.
 *
 * Reads the same places the node's diagnostics popup does: the node itself, its
 * properties and its branches' properties, then walks into each branch's
 * children. Warnings and infos are left out; only errors stop the code building.
 */
export function readFlowErrors(model: Flow | null | undefined): string[] {
    const messages = new Set<string>();
    model?.nodes?.forEach((node) => collectFromNode(node, messages));
    return Array.from(messages);
}

function collectFromNode(node: FlowNode, out: Set<string>): void {
    addErrors(node.diagnostics?.diagnostics, out);
    collectFromProperties(node.properties, out);
    node.branches?.forEach((branch) => {
        collectFromProperties(branch.properties, out);
        branch.children?.forEach((child) => collectFromNode(child, out));
    });
}

function collectFromProperties(properties: NodeProperties | undefined, out: Set<string>): void {
    for (const property of Object.values(properties ?? {})) {
        if (property?.diagnostics?.hasDiagnostics) {
            addErrors(property.diagnostics.diagnostics, out);
        }
    }
}

function addErrors(diagnostics: { message: string; severity: string }[] | undefined, out: Set<string>): void {
    diagnostics?.forEach((diagnostic) => {
        if (diagnostic.severity === "ERROR") {
            out.add(diagnostic.message);
        }
    });
}

/** Keeps the prompt readable when a broken flow reports a long list. */
const MAX_ERRORS_IN_PROMPT = 20;

/** The offer for `messages`, worded for one error or several. */
export function buildFlowErrorOffer(messages: string[], fileName?: string) {
    const count = messages.length;
    const listed = messages.slice(0, MAX_ERRORS_IN_PROMPT);
    const prompt = [
        `Fix the following errors in the flow${fileName ? ` in ${fileName}` : ""}:`,
        ...listed.map((message, index) => `${index + 1}. ${message}`),
        ...(count > listed.length ? [`(and ${count - listed.length} more)`] : []),
        "",
        "Apply the minimum required code changes to resolve these errors.",
    ].join("\n");
    return {
        kind: "flow-errors" as const,
        text: count === 1 ? "This flow has an error." : `This flow has ${count} errors.`,
        action: count === 1 ? "Fix it for me" : "Fix them for me",
        // Left unsent, like every offer: the user sees what will be asked before it runs.
        prompt: createMiniChatPrompt(prompt),
    };
}
