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

package org.ballerinalang.langserver.launchers.stdio;

import org.testng.Assert;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Tests that {@link Main#startServer} exits the process when the client closes the input stream without sending the
 * LSP {@code exit} notification (wso2/product-integrator#2854).
 */
public class StartServerExitTest {

    private PrintStream originalOut;

    @BeforeMethod
    public void captureStdout() {
        originalOut = System.out;
    }

    @AfterMethod
    public void restoreStdout() {
        // startServer redirects System.out to System.err.
        System.setOut(originalOut);
    }

    @Test(description = "Closing the input stream must exit the process with status 0", timeOut = 60_000)
    public void testExitsWhenInputStreamCloses() throws Exception {
        List<Integer> exitCodes = new ArrayList<>();

        Main.startServer(new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), exitCodes::add);

        Assert.assertEquals(exitCodes, List.of(0));
    }
}
