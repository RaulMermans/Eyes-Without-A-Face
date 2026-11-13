#!/usr/bin/env node
// Eyes Without a Face — portable integration runner.
// Application-owned, reviewed code shipped unchanged in every export package.
// Requires Node.js >= 22. No npm dependencies. No network access.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const EXIT_OK = 0;
const EXIT_VERIFY_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_RECORDS_NEED_REVIEW = 3;

function packagePath(relative) {
  if (!SAFE_PATH.test(relative) || relative.split("/").includes("..")) {
    throw new Error(`Refusing unsafe package path: ${relative}`);
  }
  return path.join(ROOT, relative);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readPackageJson(relative) {
  return readJson(packagePath(relative));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--detail") options.detail = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--")) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { command, options };
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

function writeResult(value, out, force) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!out) {
    process.stdout.write(text);
    return;
  }
  const target = path.resolve(out);
  if (target.startsWith(`${ROOT}${path.sep}`) && !force) {
    throw new Error("Refusing to write inside the package directory. Choose an output path outside it (or pass --force).");
  }
  if (existsSync(target) && !force) throw new Error(`${out} already exists. Pass --force to overwrite.`);
  writeFileSync(target, text);
  log(`Wrote ${out}`);
}

async function loadRuntime(manifest) {
  const runtimeFile = packagePath(manifest.runtime.runtimePath);
  const actual = sha256(readFileSync(runtimeFile));
  if (actual !== manifest.runtime.runtimeSha256) {
    throw new Error("The runtime file does not match the manifest hash. The package was modified; re-export it.");
  }
  const runtime = await import(runtimeFile);
  if (runtime.RUNTIME_VERSION !== manifest.runtime.runtimeVersion) {
    throw new Error(`Runtime version ${runtime.RUNTIME_VERSION} does not match the manifest (${manifest.runtime.runtimeVersion}).`);
  }
  return runtime;
}

function loadPackage() {
  const manifest = readPackageJson("manifest.json");
  if (manifest.contractKind !== "export" || manifest.schemaVersion !== "1.1.0") {
    throw new Error("manifest.json is not an Export Contract 1.1.0 manifest.");
  }
  return {
    manifest,
    mapping: readPackageJson(manifest.paths.mapping),
    schema: readPackageJson(manifest.paths.destinationSchema),
    policy: readPackageJson(manifest.paths.acceptancePolicy).policy,
  };
}

function printSummary(summary, status) {
  log(
    `${summary.total} records · ${summary.transformedValid} transformed · ${summary.handledByApprovedRule} by approved rule · ` +
      `${summary.quarantined} quarantined · ${summary.unresolved} unresolved · ${summary.rejectedByPolicy} rejected by policy`,
  );
  if (summary.quarantined > 0) log(`Quarantined (held for manual review, not dropped): records ${summary.quarantinedIndices.join(", ")}`);
  if (!summary.withinQuarantinePolicy) log("Quarantine share exceeds the packaged policy limit.");
  if (status !== "VERIFIED") log(`Package status: ${status}. This integration is not production-ready without your own review.`);
}

async function verify() {
  const { manifest, mapping, schema, policy } = loadPackage();
  let failures = 0;
  for (const file of manifest.files) {
    const actual = sha256(readFileSync(packagePath(file.path)));
    if (actual !== file.sha256) {
      log(`FAIL integrity ${file.path}`);
      failures += 1;
    }
  }
  log(failures === 0 ? `PASS integrity · ${manifest.files.length} files match manifest.json` : `FAIL integrity · ${failures} file(s) differ`);
  const runtime = await loadRuntime(manifest);
  const contractSha = sha256(Buffer.from(runtime.canonicalJson(mapping), "utf8"));
  if (contractSha !== manifest.mapping.contractSha256) {
    log("FAIL mapping contract hash differs from the manifest");
    failures += 1;
  } else log(`PASS mapping contract ${manifest.mappingId} · sha256 ${contractSha.slice(0, 16)}…`);
  const check = runtime.validateMappingContract(mapping);
  if (!check.valid) {
    log("FAIL mapping contract is not valid against the canonical schema");
    failures += 1;
  } else log("PASS canonical Mapping Contract 1.0.0 validation");
  const fixtures = readPackageJson(manifest.paths.syntheticFixtures);
  const expected = readPackageJson(manifest.paths.expectedOutputs);
  const replay = runtime.verifyFixtures({ contract: mapping, targetSchema: schema, fixtures: fixtures.records, expected, policy });
  if (!replay.ok) {
    log(`FAIL fixture replay${replay.error ? `: ${replay.error}` : ` · records ${replay.mismatches.join(", ")} differ`}`);
    failures += 1;
  } else log(`PASS fixture replay · ${replay.checked} synthetic records reproduce the outputs recorded at export`);
  log(`Package status: ${manifest.status} (verification state ${manifest.verification.state})`);
  return failures === 0 ? EXIT_OK : EXIT_VERIFY_FAILED;
}

async function runFixtures(options) {
  const { manifest, mapping, schema, policy } = loadPackage();
  const runtime = await loadRuntime(manifest);
  const fixtures = readPackageJson(manifest.paths.syntheticFixtures);
  const result = runtime.runRecords({ contract: mapping, targetSchema: schema, records: fixtures.records, policy, detail: Boolean(options.detail) });
  if (!result.ok) {
    log(`${result.error.code}: ${result.error.message}`);
    return EXIT_VERIFY_FAILED;
  }
  printSummary(result.summary, manifest.status);
  writeResult({ mappingId: manifest.mappingId, input: "synthetic fixtures", summary: result.summary, results: result.results }, options.out, options.force);
  return EXIT_OK;
}

async function runRecords(options) {
  if (!options.input) throw new Error("run needs --input <records.json>.");
  if (!options.bindings) {
    throw new Error("run needs --bindings <bindings.local.json>. Create it from `node run.mjs bindings-template`; see README.md.");
  }
  const { manifest, mapping, schema, policy } = loadPackage();
  const runtime = await loadRuntime(manifest);
  const bound = runtime.validateBindingsDocument(readJson(path.resolve(options.bindings)), mapping);
  if (!bound.ok) {
    log("Bindings rejected; nothing was executed:");
    for (const problem of bound.problems) log(`  ${problem.code}${problem.alias ? ` ${problem.alias}` : ""}: ${problem.message}`);
    return EXIT_USAGE;
  }
  const records = runtime.extractRecords(readJson(path.resolve(options.input)));
  const result = runtime.runRecords({ contract: bound.executable, targetSchema: schema, records, policy, detail: Boolean(options.detail) });
  if (!result.ok) {
    log(`${result.error.code}: ${result.error.message}`);
    return EXIT_USAGE;
  }
  printSummary(result.summary, manifest.status);
  writeResult({ mappingId: manifest.mappingId, input: path.basename(options.input), summary: result.summary, results: result.results }, options.out, options.force);
  const needsReview = result.summary.unresolved + result.summary.rejectedByPolicy + result.summary.quarantined > 0 || !result.summary.withinQuarantinePolicy;
  return needsReview ? EXIT_RECORDS_NEED_REVIEW : EXIT_OK;
}

async function template(options) {
  const { manifest, mapping } = loadPackage();
  const runtime = await loadRuntime(manifest);
  writeResult(runtime.bindingsTemplate(mapping), options.out, options.force);
  return EXIT_OK;
}

const HELP = `Eyes Without a Face integration runner

  node run.mjs verify                 Check file integrity, the contract and replay the synthetic fixtures
  node run.mjs fixtures [--out f]     Run the mapping on the packaged synthetic fixtures
  node run.mjs bindings-template      Print an empty alias → source-field bindings file
  node run.mjs run --input records.json --bindings bindings.local.json [--out results.json] [--detail]
                                      Run the mapping on your own local records

Exit codes: 0 ok · 1 verification failed · 2 usage or input error · 3 some records need review
--detail adds engine messages, which may quote record values. Keep outputs local.`;

async function main(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "verify":
      return verify();
    case "fixtures":
      return runFixtures(options);
    case "run":
      return runRecords(options);
    case "bindings-template":
      return template(options);
    case "help":
    case "--help":
      process.stdout.write(`${HELP}\n`);
      return EXIT_OK;
    default:
      log(HELP);
      return EXIT_USAGE;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_USAGE;
}
