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
 * @jest-environment node
 */

import type { ClarifyQuestion } from "@wso2/ballerina-core";
import { getAnswerLabel } from "./AskCard";

const storageQuestion: ClarifyQuestion = {
    question: "Where should the orders be stored?",
    tabLabel: "Storage",
    selectionType: "single",
    options: [
        { label: "In-memory (recommended)", value: "in_memory" },
        { label: "MySQL database", value: "mysql" },
    ],
};

describe("getAnswerLabel", () => {
    it("shows the label of the picked option", () => {
        expect(getAnswerLabel(storageQuestion, "in_memory")).toBe("In-memory (recommended)");
    });

    it("maps each answer of a multi-select question", () => {
        const multi: ClarifyQuestion = { ...storageQuestion, selectionType: "multiple" };
        expect(["in_memory", "mysql"].map(answer => getAnswerLabel(multi, answer)))
            .toEqual(["In-memory (recommended)", "MySQL database"]);
    });

    it("keeps a typed answer as it is", () => {
        expect(getAnswerLabel(storageQuestion, "Use a PostgreSQL database")).toBe("Use a PostgreSQL database");
    });

    it("keeps the answer when the question is missing", () => {
        expect(getAnswerLabel(undefined, "in_memory")).toBe("in_memory");
    });
});
