/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
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

import { BallerinaRpcClient } from "@wso2/ballerina-rpc-client";
import { Attachment, SHARED_COMMANDS } from "@wso2/ballerina-core";

export function openCopilotPanel(rpcClient: BallerinaRpcClient | undefined): void {
    rpcClient?.getCommonRpcClient().executeCommand({ commands: [SHARED_COMMANDS.OPEN_AI_PANEL] });
}

export interface CopilotPromptOptions {
    planMode?: boolean;
    attachments?: Attachment[];
    newThread?: boolean;
    hiddenContext?: string;
}

/** Shared by every inline "ask Copilot" surface so they open the panel identically. */
export function submitPromptToCopilot(
    rpcClient: BallerinaRpcClient | undefined,
    prompt: string,
    options?: CopilotPromptOptions
): boolean {
    const trimmed = prompt.trim();
    if (!trimmed) {
        openCopilotPanel(rpcClient);
        return false;
    }
    rpcClient?.getCommonRpcClient().executeCommand({
        commands: [
            SHARED_COMMANDS.OPEN_AI_PANEL,
            { type: "text", text: trimmed, planMode: false, autoSubmit: true, ...options },
        ],
    });
    return true;
}
