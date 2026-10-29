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
import org.mockito.Mockito;
import org.testng.Assert;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

import java.io.File;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Fast run copies a workspace member that imports none of its siblings on its own. Copying the whole workspace builds
 * a compiler environment, with its own compiled lang libraries, for each member: about 5 MB a member, which the last
 * compilation keeps reachable after the run. The test counts the package compilations a run makes, since each
 * environment compiles every lang library.
 *
 * @since 1.10.0
 */
public class FastRunWorkspaceCopyTest {

    private static final Path RESOURCE_DIRECTORY = Path.of("src/test/resources/fastrun/workspace_copy");

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

    private static int compilationsDuringRun(Path projectPath) throws Exception {
        Path filePath = projectPath.resolve("main.bal").toAbsolutePath();
        BallerinaWorkspaceManager workspaceManager = new BallerinaWorkspaceManager(new LanguageServerContextImpl());
        workspaceManager.loadProject(filePath);
        // Only the run's compilations: the editor's own compilation of the project happens here.
        workspaceManager.waitAndGetPackageCompilation(filePath);
        CompilationCounter.COUNT.set(0);
        CompilationCounter.enabled = true;
        try {
            Assert.assertTrue(new RunExecutor().execute(executionContext(workspaceManager, filePath)));
            return CompilationCounter.COUNT.get();
        } finally {
            CompilationCounter.enabled = false;
            workspaceManager.stop(filePath);
            FileUtils.deleteQuietly(projectPath.resolve("target").toFile());
        }
    }

    private static ExecuteCommandContext executionContext(BallerinaWorkspaceManager workspaceManager, Path filePath) {
        ExecuteCommandContext execContext =
                Mockito.mock(ExecuteCommandContext.class, Mockito.withSettings().stubOnly());
        boolean isWindows = System.getProperty("os.name").toLowerCase(Locale.ENGLISH).contains("win");
        String java = System.getProperty("java.home") + File.separator + "bin" + File.separator
                + (isWindows ? "java.exe" : "java");
        Mockito.when(execContext.getArguments()).thenReturn(List.of(
                CommandArgument.from("command", new JsonPrimitive(java)),
                CommandArgument.from("path", new JsonPrimitive(filePath.toString()))));
        Mockito.when(execContext.workspace()).thenReturn(workspaceManager);
        Mockito.when(execContext.getLanguageClient())
                .thenReturn(Mockito.mock(ExtendedLanguageClient.class, Mockito.withSettings().stubOnly()));
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
