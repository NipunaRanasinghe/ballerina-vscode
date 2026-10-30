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
package org.ballerinalang.langserver.fastrun;

import com.google.gson.JsonPrimitive;
import net.bytebuddy.agent.ByteBuddyAgent;
import net.bytebuddy.agent.builder.AgentBuilder;
import net.bytebuddy.asm.Advice;
import net.bytebuddy.matcher.ElementMatchers;
import org.apache.commons.io.FileUtils;
import org.ballerinalang.langserver.command.executors.RunExecutor;
import org.ballerinalang.langserver.commons.ExecuteCommandContext;
import org.ballerinalang.langserver.commons.client.ExtendedLanguageClient;
import org.ballerinalang.langserver.commons.command.CommandArgument;
import org.ballerinalang.langserver.contexts.LanguageServerContextImpl;
import org.ballerinalang.langserver.workspace.BallerinaWorkspaceManager;
import org.eclipse.lsp4j.DidChangeTextDocumentParams;
import org.eclipse.lsp4j.DidOpenTextDocumentParams;
import org.eclipse.lsp4j.LogTraceParams;
import org.eclipse.lsp4j.TextDocumentContentChangeEvent;
import org.eclipse.lsp4j.TextDocumentItem;
import org.eclipse.lsp4j.VersionedTextDocumentIdentifier;
import org.mockito.Mockito;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import static org.awaitility.Awaitility.await;

/**
 * Fast run copies a workspace member that imports none of its siblings on its own. Copying the whole workspace builds
 * a compiler environment, with its own compiled lang libraries, for each member: about 5 MB a member, which the last
 * compilation keeps reachable after the run. The test counts the package compilations a run makes, since each
 * environment compiles every lang library. The other tests check that both ways of copying run the editor's unsaved
 * text, and that the choice between them follows the imports in the editor, not on disk.
 *
 * @since 1.10.0
 */
public class FastRunWorkspaceCopyTest {

    private static final Path RESOURCE_DIRECTORY = Path.of("src/test/resources/fastrun/workspace_copy");
    private static final Path WORKSPACE = RESOURCE_DIRECTORY.resolve("workspace").toAbsolutePath();
    // RunExecutor logs this once each of the program's output streams closes.
    private static final String STOPPED_CHANNEL = "stopped";
    private static final long RUN_TIMEOUT_SECONDS = 60;
    // Prints a line through Java interop, as ballerina/io is not in the test task's Ballerina home.
    private static final String PRINTLN = """
            import ballerina/jballerina.java;

            function systemOut() returns handle = @java:FieldGet {
                name: "out",
                'class: "java.lang.System"
            } external;

            function println(handle receiver, handle text) = @java:Method {
                name: "println",
                'class: "java.io.PrintStream",
                paramTypes: ["java.lang.String"]
            } external;
            """;

    @BeforeClass
    public void countCompilations() {
        new AgentBuilder.Default()
                .disableClassFormatChanges()
                .with(AgentBuilder.RedefinitionStrategy.RETRANSFORMATION)
                .type(ElementMatchers.named("io.ballerina.projects.PackageCompilation"))
                .transform((builder, type, loader, module, domain) ->
                        builder.visit(Advice.to(CompilationCounter.class).on(ElementMatchers.named("from"))))
                .installOn(ByteBuddyAgent.install());
    }

    @Test
    public void testMemberWithoutSiblingImportsIsCopiedOnItsOwn() throws Exception {
        int packageCompilations = compilationsDuringRun(RESOURCE_DIRECTORY.resolve("package"));
        int memberCompilations = compilationsDuringRun(RESOURCE_DIRECTORY.resolve("workspace").resolve("one"));
        Assert.assertEquals(memberCompilations, packageCompilations,
                "A member that imports no sibling must compile as much as a package of its own, not once per member");
    }

    @Test
    public void testMemberCopiedOnItsOwnRunsUnsavedEdit() throws Exception {
        Path filePath = WORKSPACE.resolve("one").resolve("main.bal");
        BallerinaWorkspaceManager workspaceManager = new BallerinaWorkspaceManager(new LanguageServerContextImpl());
        workspaceManager.loadProject(filePath);
        open(workspaceManager, filePath);
        edit(workspaceManager, filePath, PRINTLN + """

                public function main() {
                    println(systemOut(), java:fromString("unsaved one"));
                }
                """);
        Assert.assertEquals(runOutput(workspaceManager, filePath), "unsaved one",
                "A member copied on its own must run the editor's unsaved text");
    }

    @Test
    public void testUnsavedSiblingImportCopiesWorkspace() throws Exception {
        Path filePath = WORKSPACE.resolve("one").resolve("main.bal");
        Path siblingPath = WORKSPACE.resolve("two").resolve("word.bal");
        BallerinaWorkspaceManager workspaceManager = new BallerinaWorkspaceManager(new LanguageServerContextImpl());
        workspaceManager.loadProject(filePath);
        // Both edits exist only in the editor: on disk, one imports no sibling and two returns "saved two". Both files
        // are opened before either is edited, as opening a file reloads its project from disk, which drops the unsaved
        // edits in the project's other files.
        open(workspaceManager, filePath);
        open(workspaceManager, siblingPath);
        edit(workspaceManager, siblingPath, """
                public function word() returns string {
                    return "unsaved two";
                }
                """);
        edit(workspaceManager, filePath, "import baltest/member_two;\n" + PRINTLN + """

                public function main() {
                    println(systemOut(), java:fromString(member_two:word()));
                }
                """);
        Assert.assertEquals(runOutput(workspaceManager, filePath), "unsaved two",
                "A member that imports a sibling in the editor must run with the workspace copied, with its unsaved "
                        + "edits");
    }

    private static void open(BallerinaWorkspaceManager workspaceManager, Path filePath) throws Exception {
        DidOpenTextDocumentParams params = new DidOpenTextDocumentParams();
        params.setTextDocument(new TextDocumentItem(filePath.toUri().toString(), "ballerina", 1,
                Files.readString(filePath)));
        workspaceManager.didOpen(filePath, params);
    }

    private static void edit(BallerinaWorkspaceManager workspaceManager, Path filePath, String text)
            throws Exception {
        DidChangeTextDocumentParams changeParams = new DidChangeTextDocumentParams();
        changeParams.setTextDocument(new VersionedTextDocumentIdentifier(filePath.toUri().toString(), 2));
        changeParams.getContentChanges().add(new TextDocumentContentChangeEvent(text));
        workspaceManager.didChange(filePath, changeParams);
    }

    private static String runOutput(BallerinaWorkspaceManager workspaceManager, Path filePath) throws Exception {
        Queue<LogTraceParams> logs = new ConcurrentLinkedQueue<>();
        try {
            boolean started = new RunExecutor().execute(executionContext(workspaceManager, filePath, logs));
            Assert.assertTrue(started, "Fast run did not start: " + output(logs, "err"));
            await().atMost(RUN_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .until(() -> logs.stream().filter(log -> log.getVerbose().equals(STOPPED_CHANNEL)).count() == 2);
            return output(logs, "out").trim();
        } finally {
            workspaceManager.stop(filePath);
            FileUtils.deleteQuietly(filePath.getParent().resolve("target").toFile());
        }
    }

    // RunExecutor logs the output in chunks of up to 1024 characters, not lines.
    private static String output(Queue<LogTraceParams> logs, String channel) {
        return logs.stream().filter(log -> log.getVerbose().equals(channel)).map(LogTraceParams::getMessage)
                .collect(Collectors.joining());
    }

    private static int compilationsDuringRun(Path projectPath) throws Exception {
        Path filePath = projectPath.resolve("main.bal").toAbsolutePath();
        BallerinaWorkspaceManager workspaceManager = new BallerinaWorkspaceManager(new LanguageServerContextImpl());
        workspaceManager.loadProject(filePath);
        // Only the run's compilations: the editor's own compilation of the project happens here.
        workspaceManager.waitAndGetPackageCompilation(filePath);
        CompilationCounter.COUNT.set(0);
        CompilationCounter.enabled = true;
        try {
            Assert.assertTrue(new RunExecutor().execute(executionContext(workspaceManager, filePath,
                    new ConcurrentLinkedQueue<>())));
            return CompilationCounter.COUNT.get();
        } finally {
            CompilationCounter.enabled = false;
            workspaceManager.stop(filePath);
            FileUtils.deleteQuietly(projectPath.resolve("target").toFile());
        }
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

    /**
     * Byte Buddy advice on {@code PackageCompilation.from} that counts the calls while enabled.
     */
    public static class CompilationCounter {

        public static final AtomicInteger COUNT = new AtomicInteger();
        public static volatile boolean enabled;

        @Advice.OnMethodEnter
        public static void enter() {
            if (enabled) {
                COUNT.incrementAndGet();
            }
        }
    }
}
