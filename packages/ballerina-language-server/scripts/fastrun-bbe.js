#!/usr/bin/env node
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

// Ballerina by Examples (BBEs) as packages, for testing fast run against `bal run`.
//
//   node scripts/fastrun-bbe.js import <ballerina-distribution checkout>
//     Copies every BBE the distribution checks the output of (`verifyOutput` in
//     examples/index.json) into the LS test resources as a package of its own.
//
//   node scripts/fastrun-bbe.js baseline [--workspace] [--network] [--bal <bal>] [--jobs <n>] [--only <a,b>]
//                                        [--out <dir>]
//     Runs each imported package with `bal run` and checks the output against the BBE's .out
//     file, with the rule the distribution's testExamples task uses. This is the baseline that
//     fast run is later compared with. Parallel jobs share the Central cache in ~/.ballerina,
//     and a package can fail reading a jar another job is writing, so --jobs defaults to 1.
//     With --workspace, the packages are members of workspaces of WORKSPACE_SIZE and each runs from its
//     own folder, as `bal run` from the workspace root reads `Config.toml` and relative paths from the root.
//     The BBEs in NETWORK_BBES are skipped unless --network is given.
//
// FastRunBbeTest in langserver-core runs the same packages with fast run. It applies the same output rule,
// NETWORK_BBES and WORKSPACE_SIZE, so change both together.

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BBE_DIR = path.join(__dirname, "..", "langserver-core", "src", "test", "resources", "fastrun", "bbe");
const ORG = "baltest";
// Some BBE names are keywords (`boolean`, `object`, `table`), which are not valid package names.
const NAME_PREFIX = "bbe_";
const RUN_TIMEOUT_MS = 180_000;
// These call postman-echo.com.
const NETWORK_BBES = ["alternate-receive", "multiple-receive", "multiple-wait"];
const WORKSPACE_SIZE = 10;
// Lines `bal run` prints around the program's own output, as filtered by testExamples.
const NOISE = [/^Compiling source( \(UP-TO-DATE\))?$/, /^Running executable$/, /^Resolving workspace dependencies$/,
    /^Picked up JAVA_TOOL_OPTIONS:/, /^HINT/,
    /^Generating executable$/, new RegExp(`^${ORG}/${NAME_PREFIX}\\w+:0\\.1\\.0$`)];

function importBbes(distDir) {
    const examplesDir = path.join(distDir, "examples");
    const index = JSON.parse(fs.readFileSync(path.join(examplesDir, "index.json"), "utf8"));
    const bbes = index.flatMap((category) => category.samples).filter((sample) => sample.verifyOutput);
    const commit = execFileSync("git", ["-C", distDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    fs.rmSync(BBE_DIR, { recursive: true, force: true });
    fs.mkdirSync(BBE_DIR, { recursive: true });
    for (const bbe of bbes) {
        const fileName = bbe.url.replace(/-/g, "_");
        const target = path.join(BBE_DIR, bbe.url);
        fs.cpSync(path.join(examplesDir, bbe.url), target, {
            recursive: true,
            // The .md and .metatags files are for the website, not the program.
            filter: (src) => ![`${fileName}.md`, `${fileName}.metatags`, `${bbe.url}.md`]
                .includes(path.basename(src)),
        });
        fs.writeFileSync(path.join(target, "Ballerina.toml"),
            `[package]\norg = "${ORG}"\nname = "${NAME_PREFIX}${fileName}"\nversion = "0.1.0"\n`);
    }
    fs.writeFileSync(path.join(BBE_DIR, "README.md"), [
        "# BBE packages for fast run tests",
        "",
        "Each folder is a Ballerina by Example (BBE) that the distribution checks the output of",
        "(`verifyOutput` in `examples/index.json`), with a `Ballerina.toml` added so it runs as a package.",
        "`<name>.out` is the BBE's expected output.",
        "",
        `Imported from ballerina-platform/ballerina-distribution at \`${commit}\`.`,
        "Regenerate with `node scripts/fastrun-bbe.js import <ballerina-distribution checkout>`.",
        "",
    ].join("\n"));
    console.log(`Imported ${bbes.length} BBEs into ${path.relative(process.cwd(), BBE_DIR)}`);
}

function runBal(bal, dir, flags) {
    return new Promise((resolve) => {
        const child = spawn(bal, ["run", ...flags], { cwd: dir });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => (stdout += data));
        child.stderr.on("data", (data) => (stderr += data));
        const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
        child.on("close", (code, signal) => {
            clearTimeout(timer);
            resolve({ code, timedOut: signal === "SIGKILL", stdout, stderr });
        });
    });
}

// The .out files come from single-file runs, whose stack traces name the module after the file
// (`panics:main`, or no `moduleName` in an error's stack trace) instead of the package
// (`baltest.bbe_panics.0:main`).
function toSingleFileModule(line) {
    const pkgModule = `${ORG}\\.${NAME_PREFIX}(\\w+)\\.0`;
    return line.replace(new RegExp(` moduleName: ${pkgModule} `, "g"), "  ")
        .replace(new RegExp(`${pkgModule}:`, "g"), "$1:");
}

// testExamples passes when every line the program prints appears somewhere in the .out file.
function unmatchedLines(run, outFile) {
    const expected = new Set(fs.readFileSync(outFile, "utf8").split("\n").map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")));
    return `${run.stdout}\n${run.stderr}`.split("\n").map((line) => toSingleFileModule(line.trim()))
        .filter((line) => line && !NOISE.some((noise) => noise.test(line)) && !expected.has(line));
}

async function baseline(options) {
    const bbes = fs.readdirSync(BBE_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .map((entry) => entry.name).filter((name) => !options.only || options.only.includes(name))
        .filter((name) => options.network || !NETWORK_BBES.includes(name));
    // Run copies, so `target/` and `Dependencies.toml` stay out of the test resources.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fastrun-bbe-"));
    const dirs = {};
    const size = options.workspace ? WORKSPACE_SIZE : bbes.length;
    for (let start = 0; start < bbes.length; start += size) {
        const members = bbes.slice(start, start + size);
        const parent = options.workspace ? path.join(workDir, `workspace${start / size}`) : workDir;
        for (const bbe of members) {
            dirs[bbe] = path.join(parent, bbe);
            fs.cpSync(path.join(BBE_DIR, bbe), dirs[bbe], { recursive: true });
        }
        if (options.workspace) {
            fs.writeFileSync(path.join(parent, "Ballerina.toml"),
                `[workspace]\npackages = [${members.map((bbe) => `"${bbe}"`).join(", ")}]\n`);
        }
    }
    fs.mkdirSync(options.out, { recursive: true });
    const results = [];
    let next = 0;

    async function worker() {
        while (next < bbes.length) {
            const bbe = bbes[next++];
            const dir = dirs[bbe];
            const flags = ["--offline", ...(bbe === "natural-expressions" ? ["--experimental"] : [])];
            const started = Date.now();
            const run = await runBal(options.bal, dir, flags);
            const unmatched = unmatchedLines(run, path.join(dir, `${bbe.replace(/-/g, "_")}.out`));
            const status = run.timedOut ? "timeout" : unmatched.length ? "mismatch" : "pass";
            results.push({ bbe, status, exitCode: run.code, seconds: (Date.now() - started) / 1000, unmatched });
            fs.writeFileSync(path.join(options.out, `${bbe}.log`),
                `exit: ${run.code}\n--- stdout\n${run.stdout}\n--- stderr\n${run.stderr}`);
            console.log(`[${results.length}/${bbes.length}] ${status.padEnd(8)} ${bbe}`);
        }
    }
    await Promise.all(Array.from({ length: options.jobs }, worker));
    fs.rmSync(workDir, { recursive: true, force: true });

    results.sort((a, b) => a.bbe.localeCompare(b.bbe));
    const balVersion = execFileSync(options.bal, ["version"], { encoding: "utf8" }).split("\n")[0];
    fs.writeFileSync(path.join(options.out, "results.json"), JSON.stringify({ balVersion, results }, null, 2));
    const failed = results.filter((result) => result.status !== "pass");
    console.log(`\n${balVersion}: ${results.length - failed.length}/${results.length} passed`);
    for (const result of failed) {
        console.log(`  ${result.status.padEnd(8)} ${result.bbe} (exit ${result.exitCode})`);
    }
    console.log(`Logs and results.json: ${options.out}`);
    return failed.length ? 1 : 0;
}

function parseOptions(args) {
    const options = { bal: "bal", jobs: 1, only: null, out: path.join(os.tmpdir(), "fastrun-bbe-baseline"),
        workspace: false, network: false };
    for (let i = 0; i < args.length; i += 2) {
        const value = args[i + 1];
        switch (args[i]) {
            case "--workspace": options.workspace = true; i--; break;
            case "--network": options.network = true; i--; break;
            case "--bal": options.bal = value; break;
            case "--jobs": options.jobs = Number(value); break;
            case "--only": options.only = value.split(","); break;
            case "--out": options.out = path.resolve(value); break;
            default: throw new Error(`Unknown option: ${args[i]}`);
        }
    }
    return options;
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    if (command === "import" && args.length === 1) {
        importBbes(path.resolve(args[0]));
        return 0;
    }
    if (command === "baseline") {
        return baseline(parseOptions(args));
    }
    console.error("Usage: fastrun-bbe.js import <ballerina-distribution checkout>\n"
        + "       fastrun-bbe.js baseline [--workspace] [--network] [--bal <bal>] [--jobs <n>] [--only <a,b>] [--out <dir>]");
    return 2;
}

main().then((code) => process.exit(code), (error) => {
    console.error(error);
    process.exit(1);
});
