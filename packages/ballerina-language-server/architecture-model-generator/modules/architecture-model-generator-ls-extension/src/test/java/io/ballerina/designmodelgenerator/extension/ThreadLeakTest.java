/*
 *  Copyright (c) 2026, WSO2 LLC. (http://www.wso2.com)
 *
 *  WSO2 LLC. licenses this file to you under the Apache License,
 *  Version 2.0 (the "License"); you may not use this file except
 *  in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing,
 *  software distributed under the License is distributed on an
 *  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 *  KIND, either express or implied.  See the License for the
 *  specific language governing permissions and limitations
 *  under the License.
 */

package io.ballerina.designmodelgenerator.extension;

import org.testng.Assert;
import org.testng.annotations.AfterSuite;
import org.testng.annotations.BeforeSuite;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Fails the suite if the tests left behind a thread that would keep the language server JVM alive.
 * <p>
 * When the client disconnects without sending the LSP {@code exit} notification, the stdio launcher's {@code main}
 * returns and the JVM exits only once every non-daemon thread has ended. An idle worker of an executor with no
 * keep-alive timeout, such as a single-thread scheduler created with the default thread factory, never ends, so the
 * process keeps running (wso2/product-integrator#2854). The check covers every executor reached by the tests in this
 * suite.
 */
public class ThreadLeakTest {

    private Set<Long> threadsBeforeSuite;

    @BeforeSuite
    public void recordThreads() {
        threadsBeforeSuite = Thread.getAllStackTraces().keySet().stream()
                .map(Thread::threadId)
                .collect(Collectors.toSet());
    }

    @AfterSuite(alwaysRun = true)
    public void testNoIdleNonDaemonPoolWorkers() {
        List<String> leaked = Thread.getAllStackTraces().entrySet().stream()
                .filter(entry -> !threadsBeforeSuite.contains(entry.getKey().threadId()))
                .filter(entry -> !entry.getKey().isDaemon())
                .filter(entry -> entry.getKey().getState() == Thread.State.WAITING)
                .filter(entry -> isIdlePoolWorker(entry.getValue()))
                .map(entry -> entry.getKey().getName())
                .toList();
        Assert.assertTrue(leaked.isEmpty(), "Non-daemon executor threads that wait for tasks without a timeout " +
                "keep the language server JVM alive after the client disconnects. Create the executor with a " +
                "daemon thread factory: " + leaked);
    }

    // An idle worker blocks in ThreadPoolExecutor.getTask; a WAITING state means it has no keep-alive timeout.
    private static boolean isIdlePoolWorker(StackTraceElement[] stack) {
        return Arrays.stream(stack).anyMatch(frame ->
                "java.util.concurrent.ThreadPoolExecutor".equals(frame.getClassName()) &&
                        "getTask".equals(frame.getMethodName()));
    }
}
