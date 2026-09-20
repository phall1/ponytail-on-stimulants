#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const arms = require('./arms.json');
const corpus = require('./corpus.json');
const { aggregate, scoreCase } = require('./score');

function validateSubmission(run) {
  const submission = run.submission;
  if (!submission || !Array.isArray(submission.completed) || !Array.isArray(submission.failures || []) ||
      !Array.isArray(submission.unrelatedChanges || [])) {
    throw new Error(`invalid submission schema for ${run.arm}/${run.case}`);
  }
}

function validateBalancedMatrix(runs) {
  const counts = new Map();
  for (const run of runs) {
    const key = `${run.arm}\0${run.case}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const expected = counts.get(`${Object.keys(arms)[0]}\0${corpus.cases[0].id}`) || 0;
  if (expected === 0) throw new Error('matrix must include every arm and case');
  for (const arm of Object.keys(arms)) {
    for (const testCase of corpus.cases) {
      const count = counts.get(`${arm}\0${testCase.id}`) || 0;
      if (count !== expected) throw new Error(`unbalanced matrix at ${arm}/${testCase.id}: expected ${expected}, got ${count}`);
    }
  }
  return expected;
}

function scoreRuns(document) {
  if (!document || !Array.isArray(document.runs)) throw new Error('input must contain a runs array');
  const cases = new Map(corpus.cases.map((testCase) => [testCase.id, testCase]));
  const grouped = {};
  for (const run of document.runs) {
    if (!Object.hasOwn(arms, run.arm)) throw new Error(`unknown arm: ${run.arm}`);
    const testCase = cases.get(run.case);
    if (!testCase) throw new Error(`unknown case: ${run.case}`);
    validateSubmission(run);
    (grouped[run.arm] ||= []).push(scoreCase(testCase, run.submission));
  }
  const repetitions = validateBalancedMatrix(document.runs);
  return Object.fromEntries(Object.entries(grouped).map(([arm, records]) => [arm, {
    repetitions,
    description: arms[arm].description,
    metrics: aggregate(records),
    cases: records,
  }]));
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error('usage: node benchmarks/completion/run.js <runs.json> [output.json]');
    process.exit(2);
  }
  try {
    const scored = scoreRuns(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')));
    const output = `${JSON.stringify(scored, null, 2)}\n`;
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), output);
    else process.stdout.write(output);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { scoreRuns, validateBalancedMatrix };
