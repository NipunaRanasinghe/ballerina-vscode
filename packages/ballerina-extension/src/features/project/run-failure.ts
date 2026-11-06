/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
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

/**
 * Whether an integration run's exit code means it failed on its own.
 *
 * `bal run` exits with 1 for a compile error or a crash. A run we stopped (the
 * Stop button, a restart, a newer run taking its place) ends with no exit code,
 * because VS Code reports none for a terminated task. Codes above 128 mean the
 * process was killed by a signal, such as Ctrl+C in its terminal; that is the user
 * stopping it, not a failure.
 */
export function isRunFailureExit(exitCode: number | undefined): exitCode is number {
    return exitCode !== undefined && exitCode >= 1 && exitCode <= 128;
}

/** How long a failure stays on offer; after that it is old news. */
export const RUN_FAILURE_TTL_MS = 10 * 60 * 1000;
