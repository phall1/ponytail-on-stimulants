#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const correctnessPath = path.join(root, 'benchmarks/correctness.js');

// Probe selection without relying on which Python installations the test host has.
function correctnessWithPython(probes) {
  const commands = [];
  const sandbox = {
    module: { exports: {} },
    process,
    require(name) {
      if (name !== 'child_process') return require(name);
      return {
        execSync(command) {
          commands.push(command);
          if (!command.includes(' -c ') || probes.includes(command)) return '';
          throw new Error('interpreter or import unavailable');
        },
      };
    },
  };
  vm.runInNewContext(fs.readFileSync(correctnessPath, 'utf8'), sandbox, { filename: correctnessPath });
  return { correctness: sandbox.module.exports, commands };
}

const pythonCases = [
  {
    name: 'prefers python3 when both interpreters have pandas',
    available: ['python3 -c "import pandas"', 'python -c "import pandas"'],
    probes: ['python3 -c "import pandas"'],
    selected: 'python3',
  },
  {
    name: 'prefers python with pandas over python3 without it',
    available: ['python3 -c "import sys"', 'python -c "import pandas"'],
    probes: ['python3 -c "import pandas"', 'python -c "import pandas"'],
    selected: 'python',
  },
  {
    name: 'falls back to python3 without pandas',
    available: ['python3 -c "import sys"', 'python -c "import sys"'],
    probes: ['python3 -c "import pandas"', 'python -c "import pandas"', 'python3 -c "import sys"'],
    selected: 'python3',
  },
  {
    name: 'falls back to python when python3 is unavailable',
    available: ['python -c "import sys"'],
    probes: ['python3 -c "import pandas"', 'python -c "import pandas"', 'python3 -c "import sys"', 'python -c "import sys"'],
    selected: 'python',
  },
  {
    name: 'uses the deterministic python3 default when neither interpreter works',
    available: [],
    probes: ['python3 -c "import pandas"', 'python -c "import pandas"', 'python3 -c "import sys"', 'python -c "import sys"'],
    selected: 'python3',
  },
];

for (const scenario of pythonCases) {
  test(`correctness.js: ${scenario.name} and caches the selection`, () => {
    const { correctness, commands } = correctnessWithPython(scenario.available);
    const context = { vars: { task: "Read sales.csv and sum the 'amount' column." } };
    const output = '```python\nprint(351)\n```';
    assert.equal(correctness(output, context).pass, true);
    assert.deepEqual(commands.slice(0, -1), scenario.probes);
    assert.match(commands.at(-1), new RegExp(`^${scenario.selected} ".*\\.py"$`));
    const firstCommandCount = commands.length;
    assert.equal(correctness(output, context).pass, true);
    assert.equal(commands.length, firstCommandCount + 1);
    assert.match(commands.at(-1), new RegExp(`^${scenario.selected} ".*\\.py"$`));
  });
}

function runAgenticPython(source) {
  const prelude = `
import json, os, subprocess, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path('benchmarks/agentic').resolve()))
import run as bench
`;
  const result = spawnSync('python3', ['-c', prelude + source], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('agentic/run.py: plugin selftest restores absent, empty, and caller overrides, even on exception', () => {
  runAgenticPython(`
key = 'PONYTAIL_ON_STIMULANTS_PLUGIN_DIR'
for previous in (None, '', '/caller/plugin'):
    original = {} if previous is None else {key: previous}
    with patch.dict(os.environ, original, clear=True), tempfile.TemporaryDirectory() as d:
        with patch.object(bench, 'PLUGIN_CACHE', Path(d)):
            assert bench._selftest_plugin_dir() == 0
        assert dict(os.environ) == original
        with patch.object(bench, '_plugin_dir', side_effect=RuntimeError('probe failure')):
            try:
                bench._selftest_plugin_dir()
                raise AssertionError('expected probe failure')
            except RuntimeError:
                pass
        assert dict(os.environ) == original
`);
});

test('agentic/run.py: every child arm disables inherited rule files and auto-memory without changing its parent', () => {
  runAgenticPython(`
task = {'prompt': 'integrity prompt', 'seed': {'seed.py': '# starter'}}
parent_flags = {'CLAUDE_CODE_DISABLE_CLAUDE_MDS': '0', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY': '0',
                'PONYTAIL_ON_STIMULANTS_PLUGIN_DIR': '/caller/plugin'}
with patch.dict(os.environ, parent_flags), patch.dict(bench.TASKS, {'integrity': task}):
    before = dict(os.environ)
    for arm in bench.ARMS:
        with tempfile.TemporaryDirectory() as d, patch.object(bench.shutil, 'which', return_value='/fake/claude'), \\
             patch.object(bench, '_plugin_dir', side_effect=lambda name: '/plugins/' + name), \\
             patch.object(bench.subprocess, 'Popen') as popen, \\
             patch.object(bench, 'score_workspace', return_value={'scored': True}) as score:
            assert bench.run_cell('integrity', arm, 'haiku', Path(d)) == {'scored': True}
            assert (Path(d) / 'seed.py').read_text() == '# starter'
            score.assert_called_once_with('integrity', arm, 'haiku', Path(d))
            cmd = popen.call_args.args[0]
            options = popen.call_args.kwargs
            assert cmd[:3] == ['/fake/claude', '-p', 'integrity prompt']
            assert cmd[cmd.index('--setting-sources') + 1] == 'project,local'
            assert '--strict-mcp-config' in cmd
            assert cmd[cmd.index('--disallowedTools') + 1] == 'Bash'
            assert cmd[-2] == '--append-system-prompt' and cmd[-1].endswith(bench.NO_RUN)
            if arm in bench.PLUGIN_ARMS:
                assert cmd[cmd.index('--plugin-dir') + 1] == '/plugins/' + arm
            else:
                assert '--plugin-dir' not in cmd
            if arm == 'baseline':
                assert cmd[-1] == bench.NO_RUN
            assert options['env'] == {**before, 'CLAUDE_CODE_DISABLE_CLAUDE_MDS': '1',
                                     'CLAUDE_CODE_DISABLE_AUTO_MEMORY': '1'}
            assert options['cwd'] == d
            assert options['start_new_session'] == (os.name != 'nt')
            popen.return_value.wait.assert_called_once_with(timeout=bench.CELL_TIMEOUT)
            assert dict(os.environ) == before
`);
});

test('agentic/run.py: isolation flags reach a real child process without leaking into its parent', () => {
  runAgenticPython(`
flags = ('CLAUDE_CODE_DISABLE_CLAUDE_MDS', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY')
with patch.dict(os.environ):
    for flag in flags:
        os.environ.pop(flag, None)
    with tempfile.TemporaryDirectory() as d:
        code = 'import json, os; print(json.dumps({key: os.environ.get(key) for key in ' + repr(flags) + '}))'
        bench._run_claude([sys.executable, '-c', code], Path(d))
        assert json.loads((Path(d) / '_claude.json').read_text()) == dict.fromkeys(flags, '1')
        assert all(flag not in os.environ for flag in flags)
`);
});

test('agentic/run.py: isolated child execution retains timeout tree-kill and launch error handling', () => {
  runAgenticPython(`
with tempfile.TemporaryDirectory() as d, patch.object(bench.subprocess, 'Popen') as popen, \\
     patch.object(bench, '_tree_kill') as kill:
    proc = popen.return_value
    proc.wait.side_effect = [subprocess.TimeoutExpired('claude', bench.CELL_TIMEOUT), 0]
    bench._run_claude(['fake-claude'], Path(d))
    kill.assert_called_once_with(proc)
    assert proc.wait.call_count == 2
    assert 'KILLED after' in (Path(d) / '_claude.stderr.txt').read_text()
with tempfile.TemporaryDirectory() as d, patch.object(bench.subprocess, 'Popen', side_effect=OSError('launch failed')):
    bench._run_claude(['fake-claude'], Path(d))
    assert json.loads((Path(d) / '_claude.json').read_text()) == {'error': 'launch failed'}
`);
});

test('agentic/run.py: summaries count crashed and null-score cells as failures and preserve delivered-code/usage metrics', () => {
  runAgenticPython(`
base = {'task': 't', 'arm': 'baseline', 'model': 'm'}
good = {**base, 'safe': 1, 'correct': 1, 'total_loc': 10, 'src_loc': 8, 'src_files': 1,
        'test_files': 1, 'cost': 0.01234, 'out_tokens': 20, 'in_tokens': 100,
        'cache_tokens': 10, 'duration_ms': 1250}
unsafe = {**base, 'safe': 0, 'correct': 1, 'total_loc': 30, 'src_loc': 20, 'src_files': 3,
          'test_files': 0, 'cost': 0.03234, 'out_tokens': 40, 'in_tokens': 200,
          'cache_tokens': 20, 'duration_ms': 2750}
crashed = {**base, 'error': 'boom'}
null = {**base, 'safe': None, 'correct': None, 'cost': None, 'out_tokens': None, 'duration_ms': None}
metrics = {'total_loc_median': 20, 'src_loc_median': 14, 'total_loc_max': 30, 'src_files_median': 2,
           'cost_mean': 0.0223, 'out_tokens_mean': 30, 'total_tokens_mean': 195, 'time_s_mean': 2.0}
assert bench.aggregate([good, unsafe]) == [{**base, **metrics, 'n': 2, 'safe_rate': 0.5,
       'correct_rate': 1.0, 'wrote_file_rate': 1.0, 'wrote_tests_rate': 0.5}]
assert bench.aggregate([good, crashed, null, unsafe]) == [{**base, **metrics, 'n': 4, 'safe_rate': 0.25,
       'correct_rate': 0.5, 'wrote_file_rate': 0.5, 'wrote_tests_rate': 0.25}]
empty_metrics = {'safe_rate': 0, 'correct_rate': 0, 'wrote_file_rate': 0, 'wrote_tests_rate': 0,
                 'total_loc_median': 0, 'src_loc_median': 0, 'total_loc_max': 0, 'src_files_median': 0,
                 'cost_mean': None, 'out_tokens_mean': None, 'total_tokens_mean': None, 'time_s_mean': None}
assert bench.aggregate([crashed]) == [{**base, **empty_metrics, 'n': 1}]
other = {**crashed, 'arm': 'z'}
assert bench.aggregate([other, crashed]) == [{**base, **empty_metrics, 'n': 1},
                                           {**base, **empty_metrics, 'arm': 'z', 'n': 1}]
zeros = {**null, 'cost': 0, 'out_tokens': 0, 'duration_ms': 0}
assert bench.aggregate([zeros]) == [{**base, **empty_metrics, 'n': 1, 'cost_mean': 0,
                                    'out_tokens_mean': 0, 'total_tokens_mean': 0, 'time_s_mean': 0}]
assert bench.aggregate([]) == []
assert bench._selftest_aggregate() == 0
`);
});
