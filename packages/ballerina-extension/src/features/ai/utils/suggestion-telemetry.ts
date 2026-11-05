// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com/) All Rights Reserved.

// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at

// http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import { CopilotSuggestionTelemetryRequest } from "@wso2/ballerina-core";
import { StateMachine } from "../../../stateMachine";
import { extension } from "../../../BalExtensionContext";
import { CMP_BALLERINA_AI_SUGGESTION, sendTelemetryEvent, TM_EVENT_BALLERINA_AI_SUGGESTION } from "../../telemetry";
import { getHashedProjectId } from "../../telemetry/common/project-id";

/**
 * Records a proactive offer from the Copilot orb being shown, taken up or waved
 * away, so each kind of offer can be judged on how often users take it.
 */
export async function sendCopilotSuggestionTelemetry(params: CopilotSuggestionTelemetryRequest): Promise<void> {
    const projectPath = StateMachine.context()?.projectPath || '';
    const projectId = await getHashedProjectId(projectPath);

    sendTelemetryEvent(
        extension.ballerinaExtInstance,
        TM_EVENT_BALLERINA_AI_SUGGESTION,
        CMP_BALLERINA_AI_SUGGESTION,
        {
            'suggestion.kind': params.kind,
            'suggestion.outcome': params.outcome,
            'project.id': projectId,
        }
    );
}
