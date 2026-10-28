/*
 * Copyright (c) 2026, WSO2 LLC. (http://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
package org.ballerinalang.langserver.fastrun.bbe;

import com.google.gson.JsonPrimitive;
import org.apache.commons.io.FileUtils;
import org.ballerinalang.langserver.command.executors.RunExecutor;
import org.ballerinalang.langserver.commons.ExecuteCommandContext;
import org.ballerinalang.langserver.commons.client.ExtendedLanguageClient;
import org.ballerinalang.langserver.commons.command.CommandArgument;
import org.ballerinalang.langserver.contexts.LanguageServerContextImpl;
import org.ballerinalang.langserver.workspace.BallerinaWorkspaceManager;
import org.eclipse.lsp4j.LogTraceParams;
import org.mockito.Mockito;
import org.testng.Assert;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.awaitility.Awaitility.await;

/**
 * Runs each Ballerina by Example (BBE) package in src/test/resources/fastrun/bbe with fast run and checks its output
 * against the BBE's .out file, with the rule `bal run` passes in the distribution's testExamples task and in
 * scripts/fastrun-bbe.js. The fastRunBbeTest task runs it against a real Ballerina distribution.
 *
 * @since 1.10.0
 */
public class FastRunBbeTest {

    private static final Path BBE_DIRECTORY = Path.of("src/test/resources/fastrun/bbe");
    private static final String ONLY_PROPERTY = "fastrun.bbe.only";
    private static final String OUT_CHANNEL = "out";
    private static final String ERR_CHANNEL = "err";
    // RunExecutor logs this once each of the program's output streams closes.
    private static final String STOPPED_CHANNEL = "stopped";
    private static final long RUN_TIMEOUT_SECONDS = 180;
    // Lines around the program's own output, as filtered by testExamples.
    private static final List<Pattern> NOISE = Stream.of("^Compiling source$", "^Running executable$",
            "^Picked up JAVA_TOOL_OPTIONS:", "^HINT").map(Pattern::compile).toList();
    // The .out files come from single-file runs, whose stack traces name the module after the file (`panics:main`,
    // or no `moduleName` in an error's stack trace) instead of the package (`baltest.bbe_panics.0:main`).
    private static final String PACKAGE_MODULE = "baltest\\.bbe_(\\w+)\\.0";
    private static final Pattern ERROR_MODULE = Pattern.compile(" moduleName: " + PACKAGE_MODULE + " ");
    private static final Pattern FRAME_MODULE = Pattern.compile(PACKAGE_MODULE + ":");

    @DataProvider(name = "bbes")
    public Object[][] bbes() throws IOException {
        String only = System.getProperty(ONLY_PROPERTY, "");
        Set<String> selected = Arrays.stream(only.split(",")).filter(name -> !name.isBlank())
                .collect(Collectors.toSet());
        try (Stream<Path> dirs = Files.list(BBE_DIRECTORY)) {
            return dirs.filter(Files::isDirectory).map(dir -> dir.getFileName().toString())
                    .filter(name -> selected.isEmpty() || selected.contains(name))
                    .sorted().map(name -> new Object[]{name}).toArray(Object[][]::new);
        }
    }

    @Test(dataProvider = "bbes")
    public void testBbeOutput(String bbe) throws Exception {
        // Run a copy, so the run's target/ and Dependencies.toml stay out of the test resources.
        Path projectPath = Files.createTempDirectory("fastrun-bbe-").resolve(bbe);
        FileUtils.copyDirectory(BBE_DIRECTORY.resolve(bbe).toFile(), projectPath.toFile());
        String fileName = bbe.replace('-', '_');
        BallerinaWorkspaceManager workspaceManager = new BallerinaWorkspaceManager(new LanguageServerContextImpl());
        Queue<LogTraceParams> logs = new ConcurrentLinkedQueue<>();
        try {
            Path filePath = projectPath.resolve(fileName + ".bal");
            workspaceManager.loadProject(filePath);
            boolean started = new RunExecutor().execute(executionContext(workspaceManager, filePath, logs));
            Assert.assertTrue(started, "Fast run did not start: " + output(logs, ERR_CHANNEL));
            await().atMost(RUN_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .until(() -> logs.stream().filter(log -> log.getVerbose().equals(STOPPED_CHANNEL)).count() == 2);

            String stdout = output(logs, OUT_CHANNEL);
            String stderr = output(logs, ERR_CHANNEL);
            Set<String> expected = Files.readAllLines(projectPath.resolve(fileName + ".out")).stream()
                    .map(String::trim).filter(line -> !line.isEmpty() && !line.startsWith("#"))
                    .collect(Collectors.toSet());
            List<String> unmatched = (stdout + "\n" + stderr).lines().map(String::trim)
                    .map(FastRunBbeTest::toSingleFileModule)
                    .filter(line -> !line.isEmpty() && NOISE.stream().noneMatch(noise -> noise.matcher(line).find()))
                    .filter(line -> !expected.contains(line)).toList();
            Assert.assertTrue(unmatched.isEmpty(), "Lines not in " + fileName + ".out: " + unmatched
                    + "\n--- stdout\n" + stdout + "\n--- stderr\n" + stderr);
        } finally {
            workspaceManager.stop(projectPath);
            FileUtils.deleteQuietly(projectPath.getParent().toFile());
        }
    }

    private static String toSingleFileModule(String line) {
        return FRAME_MODULE.matcher(ERROR_MODULE.matcher(line).replaceAll("  ")).replaceAll("$1:");
    }

    // RunExecutor logs the output in chunks of up to 1024 characters, not lines.
    private static String output(Queue<LogTraceParams> logs, String channel) {
        return logs.stream().filter(log -> log.getVerbose().equals(channel)).map(LogTraceParams::getMessage)
                .collect(Collectors.joining());
    }

    private static ExecuteCommandContext executionContext(BallerinaWorkspaceManager workspaceManager, Path filePath,
                                                          Queue<LogTraceParams> logs) {
        ExtendedLanguageClient languageClient =
                Mockito.mock(ExtendedLanguageClient.class, Mockito.withSettings().stubOnly());
        Mockito.doAnswer(invocation -> logs.add(invocation.getArgument(0)))
                .when(languageClient).logTrace(Mockito.any());
        ExecuteCommandContext execContext =
                Mockito.mock(ExecuteCommandContext.class, Mockito.withSettings().stubOnly());
        boolean isWindows = System.getProperty("os.name").toLowerCase(Locale.ENGLISH).contains("win");
        String java = System.getProperty("java.home") + File.separator + "bin" + File.separator
                + (isWindows ? "java.exe" : "java");
        Mockito.when(execContext.getArguments()).thenReturn(List.of(
                CommandArgument.from("command", new JsonPrimitive(java)),
                CommandArgument.from("path", new JsonPrimitive(filePath.toString()))));
        Mockito.when(execContext.workspace()).thenReturn(workspaceManager);
        Mockito.when(execContext.getLanguageClient()).thenReturn(languageClient);
        return execContext;
    }
}
