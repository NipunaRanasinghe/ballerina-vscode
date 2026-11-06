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

import type { IntegrationRunFailure } from "@wso2/ballerina-core";
import { createMiniChatPrompt } from "./promptHandoff";
import type { CopilotSuggestion } from "./suggestions";

/** A short pause, so the user sees the run's own output before the orb speaks. */
export const RUN_FAILURE_OFFER_DELAY_MS = 2 * 1000;

/** The offer to investigate an integration run that failed. */
export function buildRunFailureOffer(failure: IntegrationRunFailure): CopilotSuggestion {
    const prompt = [
        `The integration \`${failure.integration}\` (${failure.projectPath}) failed when I ran it: \`bal run\` exited with code ${failure.exitCode}.`,
        "",
        "Run it to see the output, find the cause and fix it. If the cause is outside the code, such as a port already in use or a missing config value, tell me what to change instead.",
    ].join("\n");
    return {
        kind: "run-failure",
        // The bubble shows plain text; the prompt is markdown.
        text: `${failure.integration} stopped with an error. I can find out why.`,
        action: "Investigate",
        // Taking the offer up is the go-ahead, so it runs straight away.
        prompt: createMiniChatPrompt(prompt, { autoSubmit: true }),
    };
}
