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

import { isRunFailureExit } from "../features/project/run-failure";

describe("isRunFailureExit", () => {
    it("counts a compile error or crash as a failure", () => {
        expect(isRunFailureExit(1)).toBe(true);
        expect(isRunFailureExit(128)).toBe(true);
    });

    it("does not count a clean exit, a stop we asked for, or a signal from the user", () => {
        expect(isRunFailureExit(0)).toBe(false);
        // VS Code reports no exit code for a task it terminated (Stop, restart, a newer run).
        expect(isRunFailureExit(undefined)).toBe(false);
        // Ctrl+C (SIGINT) and SIGTERM land above 128.
        expect(isRunFailureExit(130)).toBe(false);
        expect(isRunFailureExit(143)).toBe(false);
    });
});
