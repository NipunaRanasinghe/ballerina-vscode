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

import { Locator, Page, test, TestInfo } from '@playwright/test';
import { page, vscode } from '../utils/helpers';
import { logStep } from '../utils/helpers/progress';

export const DOCS_BASE_URL = 'https://wso2.com/docs-integrator/integrator';

// A published docs page that a journey follows step by step.
export interface DocPage {
    title: string;
    // Path under the docs site, e.g. `get-started/quickstarts/build-durable-workflow`.
    slug: string;
}

// Where the product and the page disagree; reported, not failed. Kinds: label (named differently), missing, behaviour,
// gap (a step the reader must add), clarity, blocked (needs what CI lacks, e.g. a sign-in).
export interface Finding {
    kind: 'label' | 'missing' | 'behaviour' | 'gap' | 'clarity' | 'blocked';
    step: string;
    says: string;
    actual: string;
    suggestion?: string;
}

export const DOC_FINDING = 'doc-finding';

const plain = (text: string) => text.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

// One docs page followed in the designer: its steps, the doc-vs-UI name lookups and the findings.
export class DocJourney {
    readonly findings: Finding[] = [];
    private currentStep = '';

    constructor(readonly doc: DocPage, private readonly info: TestInfo = test.info()) {}

    // The window on screen now: the extension can reload the window, which closes the page the harness holds.
    get page(): Page {
        if (!page.page.isClosed() || !vscode) {
            return page.page;
        }
        const open = (vscode.windows() as Page[]).filter((window) => !window.isClosed());
        return open[open.length - 1] ?? page.page;
    }

    get stepId(): string {
        return this.currentStep;
    }

    // One numbered step of the page, quoted as written.
    async step<T>(id: string, text: string, body: () => Promise<T>): Promise<T> {
        this.currentStep = id;
        const title = `${id} ${plain(text)}`;
        logStep(`${this.doc.title} · ${title}`);
        return test.step(title, body);
    }

    async finding(finding: Omit<Finding, 'step'> & { step?: string }): Promise<void> {
        const recorded: Finding = { ...finding, step: finding.step ?? this.currentStep };
        this.findings.push(recorded);
        const description = `[${this.doc.title} · ${recorded.step} · ${recorded.kind}] page: ${recorded.says} | product: ${recorded.actual}`
            + (recorded.suggestion ? ` | suggested: ${recorded.suggestion}` : '');
        this.info.annotations.push({ type: DOC_FINDING, description });
        console.log(`  📝 ${description}`);
        const shot = await this.page.screenshot().catch(() => undefined);
        if (shot) {
            await this.info.attach(`finding ${this.findings.length} (${recorded.step})`, { body: shot, contentType: 'image/png' });
        }
    }

    // Attaches the findings as JSON, for collecting into the docs team's report.
    async attachFindings(): Promise<void> {
        await this.info.attach('doc-findings', {
            body: JSON.stringify({ doc: this.doc, url: `${DOCS_BASE_URL}/${this.doc.slug}`, findings: this.findings }, null, 2),
            contentType: 'application/json',
        });
    }

    // Finds a control by the page's name, falling back to the UI's; a fallback that is needed becomes a finding.
    async resolve(names: { doc: string; ui?: string | string[] }, make: (name: string) => Locator,
        timeoutMs = 30_000): Promise<Locator> {
        const alternatives = names.ui === undefined ? [] : Array.isArray(names.ui) ? names.ui : [names.ui];
        const byDoc = make(names.doc).first();
        // Forms render inputs after their heading; a UI name only wins once the page's name had a beat to show.
        const deadline = Date.now() + timeoutMs;
        let uiSeenAt = 0;
        while (Date.now() < deadline) {
            if (await byDoc.isVisible().catch(() => false)) {
                return byDoc;
            }
            for (const name of alternatives) {
                const byUi = make(name).first();
                if (await byUi.isVisible().catch(() => false)) {
                    uiSeenAt ||= Date.now();
                    if (Date.now() - uiSeenAt >= 1_000) {
                        await this.finding({ kind: 'label', says: names.doc, actual: name, suggestion: `Call it **${name}**, as the UI does.` });
                        return byUi;
                    }
                }
            }
            await this.page.waitForTimeout(250);
        }
        throw new Error(`Step ${this.currentStep}: neither the page's '${names.doc}' nor ${alternatives.map((a) => `'${a}'`).join(', ') || 'any known UI name'} is visible`);
    }

    async click(target: Locator, options: { force?: boolean; dom?: boolean } = {}): Promise<void> {
        await target.waitFor({ state: 'visible', timeout: 30_000 });
        await target.scrollIntoViewIfNeeded().catch(() => undefined);
        if (options.dom) {
            await target.dispatchEvent('click');
            return;
        }
        await target.click({ force: options.force ?? true, timeout: 10_000 }).catch(() => target.dispatchEvent('click'));
    }

    // Clicks until the expected result shows: some controls keep their handler on a wrapper, and a click that
    // lands while the view re-renders is dropped.
    async clickUntil(target: Locator, result: Locator, timeoutMs = 4_000): Promise<void> {
        await this.click(target);
        for (const candidate of [target, target.locator('xpath=..'), target.locator('xpath=../..')]) {
            if (await result.first().waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true).catch(() => false)) {
                return;
            }
            await candidate.dispatchEvent('click').catch(() => undefined);
        }
        await result.first().waitFor({ state: 'visible', timeout: timeoutMs });
    }

    async hover(target: Locator): Promise<void> {
        await target.waitFor({ state: 'visible', timeout: 30_000 });
        await target.hover({ force: true }).catch(() => undefined);
    }

    async pointTo(x: number, y: number): Promise<void> {
        await this.page.mouse.move(x, y);
    }

    // Types into the focused control once it has settled; a control that re-renders on focus drops early keys.
    async typeFocused(text: string, replace = true): Promise<void> {
        await this.page.waitForTimeout(700);
        if (replace) {
            await this.page.keyboard.press('ControlOrMeta+A');
        }
        await this.page.keyboard.insertText(text);
    }

    typeDelay(): number {
        return 0;
    }

    async beat(_demoMs = 900, settleMs = 250): Promise<void> {
        await this.page.waitForTimeout(settleMs);
    }
}
