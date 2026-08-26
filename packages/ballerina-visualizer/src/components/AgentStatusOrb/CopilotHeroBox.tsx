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

import React, { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { BallerinaRpcClient, useRpcContext } from "@wso2/ballerina-rpc-client";
import { SHARED_COMMANDS, AgentRunStatus } from "@wso2/ballerina-core";
import { Codicon, Icon } from "@wso2/ui-toolkit";
import { CopilotOrb } from "./CopilotOrb";
import { useOrbColors } from "./orbTheme";
import {
    activeStateLabel,
    AmbientFrame,
    useSuppressAgentStatusOrb,
    subscribeAgentRunStatus,
} from "./shared";

export function openCopilotPanel(rpcClient: BallerinaRpcClient | undefined): void {
    rpcClient?.getCommonRpcClient().executeCommand({ commands: [SHARED_COMMANDS.OPEN_AI_PANEL] });
}

export interface CopilotPromptOptions {
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

/**
 * Inline "ask the Copilot" prompt box in the package overview's design panel,
 * the primary way into the Copilot from that page. Submitting opens the AI
 * panel with the prompt auto-submitted into the agent. While a run is active
 * the box morphs into the orb + live status label (the same status feed as the
 * floating AgentStatusOrb), and clicking it opens the panel.
 *
 * While mounted it suppresses the floating orb — one copilot surface per view.
 */

const HERO_ORB_SIZE = 44;

const Box = styled.div<{ active: boolean }>`
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    border-radius: 12.5px;
    background: var(--vscode-editorWidget-background);
    cursor: ${(props: { active: boolean }) => (props.active ? "pointer" : "text")};
`;

const PromptInput = styled.input`
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--vscode-input-foreground);
    font-family: var(--vscode-font-family);
    font-size: 14px;
    &::placeholder {
        color: var(--vscode-input-placeholderForeground);
    }
`;

const StatusText = styled.div`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-foreground);
    font-size: 14px;
`;

const OpenHint = styled.div`
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--vscode-textLink-foreground);
    font-size: 12px;
    white-space: nowrap;
`;

const SendButton = styled.button`
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 9px;
    padding: 0;
    font-size: 16px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    cursor: pointer;
    transition: filter 0.15s ease, transform 0.15s ease;
    &:hover {
        filter: brightness(1.12);
        transform: translateY(-1px);
    }
    &:active {
        transform: translateY(0);
    }
`;

export function CopilotHeroBox({ placeholder }: { placeholder: string }) {
    const { rpcClient } = useRpcContext();
    const [status, setStatus] = useState<AgentRunStatus | null>(null);
    const [text, setText] = useState("");
    const inputRef = useRef<HTMLInputElement | null>(null);

    useSuppressAgentStatusOrb();

    useEffect(() => {
        if (!rpcClient) {
            return;
        }
        return subscribeAgentRunStatus(rpcClient, setStatus);
    }, [rpcClient]);

    // Unlike the floating orb, a missing status does not hide the box: with no
    // status yet (or an older host without the RPC) it is still the AI entry
    // point, just in its idle prompt form.
    const state = status?.state ?? "idle";
    const active = state !== "idle";
    const colors = useOrbColors(state);
    const label = active && status ? activeStateLabel(status) : null;

    const openCopilot = () => openCopilotPanel(rpcClient);

    const submit = () => {
        if (submitPromptToCopilot(rpcClient, text)) {
            setText("");
        }
    };

    return (
        <AmbientFrame $variant="hero" $state={state}>
            <Box
                active={active}
                onClick={() => (active ? openCopilot() : inputRef.current?.focus())}
                role={active ? "button" : undefined}
                tabIndex={active ? 0 : undefined}
                onKeyDown={(event) => {
                    if (active && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        openCopilot();
                    }
                }}
                aria-label={label ? `WSO2 Integration Intelligence: ${label}. Open the WSO2 Integration Intelligence chat.` : undefined}
            >
                <CopilotOrb state={state} colors={colors} size={HERO_ORB_SIZE} iconSize={20} />
                {active ? (
                    <>
                        <StatusText>{label}</StatusText>
                        <OpenHint>
                            Open WSO2 Integration Intelligence <Codicon name="arrow-right" />
                        </OpenHint>
                    </>
                ) : (
                    <>
                        <PromptInput
                            ref={inputRef}
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    submit();
                                }
                            }}
                            placeholder={placeholder}
                            aria-label="Message WSO2 Integration Intelligence"
                        />
                        <SendButton
                            title="Send to WSO2 Integration Intelligence"
                            aria-label="Send to WSO2 Integration Intelligence"
                            onClick={(event) => {
                                event.stopPropagation();
                                submit();
                            }}
                        >
                            <Icon name="Send" sx={{ fontSize: "16px" }} />
                        </SendButton>
                    </>
                )}
            </Box>
        </AmbientFrame>
    );
}
