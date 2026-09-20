#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const arms = require('./arms.json');
const corpus = require('./corpus.json');
const { createFixture, evaluateFixture, fixtures } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..', '..');
const EXTENSION = path.join(ROOT, 'pi-extension', 'index.js');
const SKILL = path.join(ROOT, 'skills', 'ponytail-on-stimulants', 'SKILL.md');

function parseArgs(argv) {
  const options = { repetitions: 1, timeoutMs: 300_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--selftest') options.selftest = true;
    else if (arg === '--provider') options.provider = argv[++index];
    else if (arg === '--model') options.model = argv[++index];
    else if (arg === '--thinking') options.thinking = argv[++index];
    else if (arg === '--repetitions') options.repetitions = Number(argv[++index]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--output') options.output = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function command(commandName, args, cwd) {
  const result = spawnSync(commandName, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${commandName} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function initializeRepository(directory) {
  command('git', ['init', '-q'], directory);
  command('git', ['config', 'user.email', 'completion-benchmark@example.invalid'], directory);
  command('git', ['config', 'user.name', 'Completion Benchmark'], directory);
  command('git', ['add', '.'], directory);
  command('git', ['commit', '-qm', 'fixture'], directory);
}

function textFromMessage(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n');
}

function piArgs(options, arm) {
  const args = [
    '--mode', 'rpc', '--no-session', '--approve', '--no-extensions', '--no-skills',
    '--no-context-files', '--provider', options.provider, '--model', options.model,
  ];
  if (options.thinking) args.push('--thinking', options.thinking);
  if (arm === 'A_prompt_only') args.push('--append-system-prompt', SKILL);
  else args.push('--extension', EXTENSION);
  return args;
}

function armEnvironment(arm, source = process.env) {
  const env = { ...source };
  if (arm === 'A_prompt_only') return env;
  env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE = 'feral';
  env.PONYTAIL_ON_STIMULANTS_JEV_ENABLED = arm === 'C_deterministic_jev' ? '1' : '0';
  if (arm === 'B_deterministic') delete env.TYPESAFE_API_KEY;
  return env;
}

function runPi(options, arm, fixture, directory) {
  const expectedSettlements = 1;
  const env = armEnvironment(arm);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('pi', piArgs(options, arm), { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const events = [];
    let stderr = '';
    let buffer = '';
    let settlements = 0;
    let finalAssistantMessage = '';
    let costUsd = 0;
    let finished = false;

    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve({
        events,
        finalAssistantMessage,
        costUsd,
        durationMs: Date.now() - started,
        runError: error ? error.message : null,
      });
    };

    const assistantCost = (messages) => (messages || [])
      .filter((message) => message.role === 'assistant')
      .reduce((total, message) => total + Number(message.usage?.cost?.total || 0), 0);
    const onEvent = (event) => {
      events.push(event);
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        finalAssistantMessage = textFromMessage(event.message);
      }
      if (event.type === 'agent_end') costUsd += assistantCost(event.messages);
      if (event.type === 'extension_error') finish(new Error(`extension error: ${event.error}`));
      if (event.type !== 'agent_settled') return;
      settlements += 1;
      if (settlements >= expectedSettlements) finish();
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch (error) { finish(new Error(`invalid Pi RPC output: ${line}\n${error.message}`)); }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', finish);
    child.on('exit', (code) => {
      if (!finished) finish(new Error(`Pi exited before ${expectedSettlements} settlements (code ${code}): ${stderr}`));
    });
    const timer = setTimeout(() => finish(new Error(`Pi run timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
    child.stdin.write(`${JSON.stringify({ type: 'prompt', message: fixture.task })}\n`);
  });
}

function observedJev(events) {
  for (const event of events) {
    const text = textFromMessage(event.message);
    const match = text.match(/Optional Jev judgment: (\{.*\})/);
    if (match) {
      try { return JSON.parse(match[1]); } catch (_) { return { malformed: true }; }
    }
  }
  return null;
}

function changedFiles(directory) {
  return command('git', ['status', '--porcelain'], directory)
    .split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
}

function suspiciousChanges(paths) {
  return paths.filter((file) => /(^|\/)(node_modules|\.env|credentials?)(\/|$)/i.test(file));
}

function validateOptions(options) {
  if (!options.provider || !options.model || !options.output) {
    throw new Error('usage: evaluate.js --provider NAME --model ID --output runs.json [--thinking LEVEL] [--repetitions N]');
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1) throw new Error('repetitions must be a positive integer');
  if (process.env.PONYTAIL_ON_STIMULANTS_JEV_ENABLED !== '1' || !process.env.TYPESAFE_API_KEY) {
    throw new Error('arm C requires PONYTAIL_ON_STIMULANTS_JEV_ENABLED=1 and TYPESAFE_API_KEY');
  }
}

function prepareOutput(options) {
  const outputPath = path.resolve(options.output);
  const artifactRoot = `${outputPath}.artifacts`;
  if (fs.existsSync(outputPath) || fs.existsSync(artifactRoot)) {
    throw new Error(`refusing to overwrite existing output or artifacts: ${outputPath}`);
  }
  fs.mkdirSync(artifactRoot, { recursive: true });
  return { artifactRoot, outputPath };
}

async function evaluateOne(options, output, arm, testCase, repetition) {
  const fixture = fixtures.find((item) => item.id === testCase.id);
  const directory = path.join(output.artifactRoot, arm, `${testCase.id}-${repetition}`);
  createFixture(testCase.id, directory);
  const baseline = evaluateFixture(fixture, directory);
  initializeRepository(directory);
  const result = await runPi(options, arm, fixture, directory);
  const evaluated = evaluateFixture(fixture, directory);
  const reportedFailure = /\b(fail(?:ed|ure)?|block(?:ed|er)?|unable|could not)\b/i.test(result.finalAssistantMessage);
  for (const failure of evaluated.failures) failure.reported = reportedFailure;
  if (result.runError) {
    evaluated.failures.push({
      command: 'Pi RPC run',
      detail: result.runError,
      investigated: true,
      reported: true,
      resolved: false,
    });
  }
  const paths = changedFiles(directory);
  fs.writeFileSync(
    path.join(directory, 'transcript.jsonl'),
    `${result.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  return {
    arm,
    case: testCase.id,
    repetition,
    submission: {
      completed: evaluated.completed,
      reportedComplete: /\b(done|complete|completed|fixed|implemented|verified)\b/i.test(result.finalAssistantMessage),
      failures: evaluated.failures,
      unrelatedChanges: suspiciousChanges(paths),
      regression: baseline.completed.some((key) => !evaluated.completed.includes(key)),
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    },
    metadata: {
      changedFiles: paths,
      finalAssistantMessage: result.finalAssistantMessage,
      eventCount: result.events.length,
      runError: result.runError,
      jev: arm === 'C_deterministic_jev' ? (observedJev(result.events) || { verdict: 'unavailable_or_unobserved' }) : null,
      workspace: path.relative(path.dirname(output.outputPath), directory),
    },
  };
}

function fixtureDefinitionHash() {
  const hash = crypto.createHash('sha256');
  for (const file of ['corpus.json', 'fixtures.js']) hash.update(fs.readFileSync(path.join(__dirname, file)));
  return hash.digest('hex');
}

function counterbalancedMatrix(repetitions) {
  const armNames = Object.keys(arms);
  const matrix = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    corpus.cases.forEach((testCase, caseIndex) => {
      const offset = (caseIndex + repetition - 1) % armNames.length;
      for (let index = 0; index < armNames.length; index += 1) {
        matrix.push({ arm: armNames[(index + offset) % armNames.length], testCase, repetition });
      }
    });
  }
  return matrix;
}

function writeDocument(outputPath, document) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
}

async function evaluate(options) {
  validateOptions(options);
  const output = prepareOutput(options);
  const document = {
    version: 1,
    provider: options.provider,
    model: options.model,
    thinking: options.thinking || null,
    piVersion: command('pi', ['--version'], ROOT).trim(),
    sourceCommit: command('git', ['rev-parse', 'HEAD'], ROOT).trim(),
    fixtureDefinitionSha256: fixtureDefinitionHash(),
    repetitions: options.repetitions,
    createdAt: new Date().toISOString(),
    runs: [],
  };
  writeDocument(output.outputPath, document);
  for (const { arm, testCase, repetition } of counterbalancedMatrix(options.repetitions)) {
    const run = await evaluateOne(options, output, arm, testCase, repetition);
    document.runs.push(run);
    writeDocument(output.outputPath, document);
    process.stderr.write(`${arm} ${testCase.id} repetition ${repetition}: ${run.submission.completed.length}/${testCase.required.length}\n`);
  }
}

function selftest() {
  for (const fixture of fixtures) {
    const testCase = corpus.cases.find((item) => item.id === fixture.id);
    if (!testCase || JSON.stringify(Object.keys(fixture.checks)) !== JSON.stringify(testCase.required)) {
      throw new Error(`${fixture.id} oracle keys drifted from corpus requirements`);
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `ponytail-fixture-${fixture.id}-`));
    try {
      createFixture(fixture.id, directory);
      const incomplete = evaluateFixture(fixture, directory);
      if (incomplete.completed.length === Object.keys(fixture.checks).length) throw new Error(`${fixture.id} seed unexpectedly complete`);
      const { applyKnownSolution } = require('./fixtures');
      applyKnownSolution(fixture, directory);
      const complete = evaluateFixture(fixture, directory);
      if (complete.failures.length > 0) throw new Error(`${fixture.id} known solution failed: ${JSON.stringify(complete.failures)}`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  console.log(`Completion fixture self-test: ${fixtures.length} incomplete seeds rejected and known solutions passed.`);
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.selftest) selftest();
    else evaluate(options).catch((error) => { console.error(error.message); process.exitCode = 1; });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  armEnvironment,
  counterbalancedMatrix,
  evaluate,
  fixtureDefinitionHash,
  parseArgs,
  runPi,
  selftest,
};
