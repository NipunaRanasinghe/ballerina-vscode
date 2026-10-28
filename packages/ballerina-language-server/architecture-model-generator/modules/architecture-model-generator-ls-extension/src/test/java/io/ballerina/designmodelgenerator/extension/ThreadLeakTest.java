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

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Fails the suite if the tests left behind a thread that would keep the language server JVM alive.
 * <p>
 * The stdio launcher calls {@code System.exit} when the client disconnects, so these threads do not keep that
 * process alive. A host that runs the language server without calling {@code System.exit}, such as an embedding
 * process or a test JVM, exits only once every non-daemon thread has ended. An idle worker of an executor with no
 * keep-alive timeout, such as a single-thread scheduler created with the default thread factory, never ends, so such
 * a process keeps running (wso2/product-integrator#2854). The check also keeps the fix in place if the launcher's
 * exit call is removed. It covers every executor reached by the tests in this suite.
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
                .filter(entry -> isIdlePoolWorker(entry.getValue()))
                .map(entry -> entry.getKey().getName())
                .toList();
        Assert.assertTrue(leaked.isEmpty(), "Non-daemon executor threads that wait for tasks without a timeout " +
                "keep the language server JVM alive after the client disconnects. Create the executor with a " +
                "daemon thread factory: " + leaked);
    }

    // An idle worker blocks in ThreadPoolExecutor.getTask. A core worker calls the queue's take(), which has no
    // timeout; a worker that can time out calls poll(). The thread state does not tell them apart: a scheduler's
    // core worker is TIMED_WAITING while a task, even a cancelled one, is still queued.
    private static boolean isIdlePoolWorker(StackTraceElement[] stack) {
        for (int i = 1; i < stack.length; i++) {
            if ("java.util.concurrent.ThreadPoolExecutor".equals(stack[i].getClassName()) &&
                    "getTask".equals(stack[i].getMethodName())) {
                return "take".equals(stack[i - 1].getMethodName());
            }
        }
        return false;
    }
}
