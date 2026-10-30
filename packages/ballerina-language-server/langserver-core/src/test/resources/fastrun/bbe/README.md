# BBE packages for fast run tests

Each folder is a Ballerina by Example (BBE) that the distribution checks the output of
(`verifyOutput` in `examples/index.json`), with a `Ballerina.toml` added so it runs as a package.
`<name>.out` is the BBE's expected output.

These are 27 of the 223: one for each combination of the traits that change
what fast run does with a program (imported modules, error or panic output, non-ASCII output,
configurables, workers or strands), and two for a combination ten or more BBEs share.
`selectSubset` in `scripts/fastrun-bbe.js` has the rule.

Imported from ballerina-platform/ballerina-distribution at `56f38f34e149ea75e37c79024664202c9a559740`.
Regenerate with `node scripts/fastrun-bbe.js import <ballerina-distribution checkout>`.
