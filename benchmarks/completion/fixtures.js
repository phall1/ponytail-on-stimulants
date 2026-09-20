'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const fixtures = [
  {
    id: 'shared-callers',
    task: 'Endpoint A accepts negative amounts. Fix the shared root cause, account for every caller, and run the focused checks.',
    files: {
      'amount.js': "exports.amount = (value) => Number(value);\n",
      'service.js': "const { amount } = require('./amount');\nexports.endpointA = (v) => amount(v);\nexports.endpointB = (v) => amount(v);\n",
      'test.js': "const assert=require('node:assert/strict');const s=require('./service');for(const f of [s.endpointA,s.endpointB])assert.throws(()=>f(-1));\n",
    },
    solution: {
      'amount.js': "exports.amount = (value) => { const n=Number(value); if (!Number.isFinite(n) || n < 0) throw new Error('invalid amount'); return n; };\n",
    },
    checks: {
      shared_root_fix: "assert.throws(()=>require('./amount').amount(-1))",
      caller_a_checked: "assert.throws(()=>require('./service').endpointA(-1))",
      caller_b_checked: "assert.throws(()=>require('./service').endpointB(-1))",
      focused_tests: "require('./test')",
    },
  },
  {
    id: 'stale-serialization',
    task: 'Rename the public Record field from name to displayName. Keep deserialization compatible with old persisted records and verify round trips; remove stale runtime uses of the old field.',
    files: {
      'record.js': "class Record { constructor(name){ this.name=name; } }\nexports.Record=Record;\nexports.serialize=(record)=>JSON.stringify({name:record.name});\nexports.deserialize=(text)=>{const data=JSON.parse(text);return new Record(data.name)};\n",
      'test.js': "const assert=require('node:assert/strict');const r=require('./record');const x=new r.Record('Ada');assert.equal(x.displayName,'Ada');assert.deepEqual(JSON.parse(r.serialize(x)),{displayName:'Ada'});assert.equal(r.deserialize('{\"name\":\"Old\"}').displayName,'Old');assert.equal(r.deserialize(r.serialize(x)).displayName,'Ada');\n",
    },
    solution: {
      'record.js': "class Record { constructor(displayName){ this.displayName=displayName; } }\nexports.Record=Record;\nexports.serialize=(record)=>JSON.stringify({displayName:record.displayName});\nexports.deserialize=(text)=>{const data=JSON.parse(text);return new Record(data.displayName ?? data.name)};\n",
    },
    checks: {
      runtime_field: "assert.equal(new (require('./record').Record)('Ada').displayName,'Ada')",
      serializer: "assert.deepEqual(JSON.parse(require('./record').serialize(new (require('./record').Record)('Ada'))),{displayName:'Ada'})",
      deserializer: "assert.equal(require('./record').deserialize('{\"name\":\"Old\"}').displayName,'Old')",
      round_trip_test: "require('./test')",
      old_symbol_search: "const s=fs.readFileSync('record.js','utf8');assert.doesNotMatch(s,/this\\.name|record\\.name|\\{name:/)",
    },
  },
  {
    id: 'cli-contract',
    task: 'Add an --uppercase CLI option. Wire parser, runtime behavior, help text, parser tests, and an executable CLI path.',
    files: {
      'cli.js': "exports.parse=(args)=>({text:args[0]||''});\nexports.run=(args)=>exports.parse(args).text;\nexports.help='Usage: echo TEXT';\nif(require.main===module)process.stdout.write(exports.run(process.argv.slice(2)));\n",
      'test.js': "const assert=require('node:assert/strict');const c=require('./cli');assert.deepEqual(c.parse(['hello','--uppercase']),{text:'hello',uppercase:true});assert.equal(c.run(['hello','--uppercase']),'HELLO');assert.match(c.help,/--uppercase/);\n",
    },
    solution: {
      'cli.js': "exports.parse=(args)=>({text:args.find(a=>!a.startsWith('--'))||'',uppercase:args.includes('--uppercase')});\nexports.run=(args)=>{const o=exports.parse(args);return o.uppercase?o.text.toUpperCase():o.text};\nexports.help='Usage: echo TEXT [--uppercase]';\nif(require.main===module)process.stdout.write(exports.run(process.argv.slice(2)));\n",
    },
    checks: {
      parser: "assert.equal(require('./cli').parse(['x','--uppercase']).uppercase,true)",
      runtime_behavior: "assert.equal(require('./cli').run(['hello','--uppercase']),'HELLO')",
      help_text: "assert.match(require('./cli').help,/--uppercase/)",
      parser_tests: "require('./test')",
      cli_execution: "const r=cp.spawnSync(process.execPath,['cli.js','hello','--uppercase'],{encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout,'HELLO')",
    },
  },
  {
    id: 'api-client',
    task: 'Rename the bundled user API response field from name to displayName and update every server/runtime/client contract path with integration coverage.',
    files: {
      'server.js': "exports.getUser=(id)=>({id,name:'Ada'});\n",
      'client.js': "exports.label=(user)=>user.name;\n",
      'test.js': "const assert=require('node:assert/strict');const s=require('./server'),c=require('./client');const u=s.getUser(1);assert.deepEqual(u,{id:1,displayName:'Ada'});assert.equal(c.label(u),'Ada');\n",
    },
    solution: {
      'server.js': "exports.getUser=(id)=>({id,displayName:'Ada'});\n",
      'client.js': "exports.label=(user)=>user.displayName;\n",
    },
    checks: {
      server_contract: "assert.deepEqual(require('./server').getUser(1),{id:1,displayName:'Ada'})",
      server_runtime: "assert.equal(require('./server').getUser(2).displayName,'Ada')",
      client_consumer: "assert.equal(require('./client').label({displayName:'Grace'}),'Grace')",
      contract_tests: "require('./test')",
      integration_test: "const u=require('./server').getUser(1);assert.equal(require('./client').label(u),'Ada')",
    },
  },
  {
    id: 'schema-migration',
    task: 'Move persisted lists from schema v1 {names:string[]} to v2 {items:{label:string}[]}. Migrate existing data and keep read/write paths consistent; prove it on disposable data.',
    files: {
      'store.js': "exports.load=(data)=>data;\nexports.save=(value)=>JSON.stringify(value);\n",
      'test.js': "const assert=require('node:assert/strict');const s=require('./store');const migrated=s.load({version:1,names:['Ada']});assert.deepEqual(migrated,{version:2,items:[{label:'Ada'}]});assert.deepEqual(JSON.parse(s.save(migrated)),migrated);\n",
    },
    solution: {
      'store.js': "exports.load=(data)=>data.version===1?{version:2,items:data.names.map(label=>({label}))}:data;\nexports.save=(value)=>JSON.stringify({version:2,items:value.items});\n",
    },
    checks: {
      schema: "assert.deepEqual(JSON.parse(require('./store').save({items:[]})),{version:2,items:[]})",
      migration: "assert.deepEqual(require('./store').load({version:1,names:['Ada']}),{version:2,items:[{label:'Ada'}]})",
      read_path: "assert.deepEqual(require('./store').load({version:2,items:[{label:'Ada'}]}).items,[{label:'Ada'}])",
      write_path: "assert.equal(JSON.parse(require('./store').save({items:[{label:'Ada'}]})).items[0].label,'Ada')",
      disposable_apply: "require('./test')",
    },
  },
  {
    id: 'generated-code',
    task: 'Change the canonical generated user field from name to displayName, run the existing generator, and leave its committed output drift-free.',
    files: {
      'schema.txt': 'name\n',
      'generate.js': "const fs=require('node:fs');const field=fs.readFileSync('schema.txt','utf8').trim();fs.writeFileSync('generated.js',`exports.field=${JSON.stringify(field)};\\n`);\n",
      'generated.js': "exports.field='name';\n",
    },
    solution: {
      'schema.txt': 'displayName\n',
      'generated.js': "exports.field=\"displayName\";\n",
    },
    checks: {
      canonical_source: "assert.equal(fs.readFileSync('schema.txt','utf8').trim(),'displayName')",
      generator_run: "const before=fs.readFileSync('generated.js','utf8');cp.execFileSync(process.execPath,['generate.js']);assert.equal(fs.readFileSync('generated.js','utf8'),before)",
      generated_output: "delete require.cache[require.resolve('./generated')];assert.equal(require('./generated').field,'displayName')",
      drift_check: "cp.execFileSync(process.execPath,['generate.js']);assert.equal(require('./generated').field,'displayName')",
    },
  },
  {
    id: 'sibling-build',
    task: 'Fix the shared build script so both web and mobile targets build. Exercise both sibling targets and the package tests.',
    files: {
      'build.js': "exports.build=(target)=>{if(target!=='web')throw new Error('unsupported');return `built ${target}`};\nif(require.main===module)console.log(exports.build(process.argv[2]));\n",
      'test.js': "const assert=require('node:assert/strict');const b=require('./build');assert.equal(b.build('web'),'built web');assert.equal(b.build('mobile'),'built mobile');\n",
    },
    solution: {
      'build.js': "exports.build=(target)=>{if(!['web','mobile'].includes(target))throw new Error('unsupported');return `built ${target}`};\nif(require.main===module)console.log(exports.build(process.argv[2]));\n",
    },
    checks: {
      shared_script: "assert.match(fs.readFileSync('build.js','utf8'),/mobile/)",
      target_a_build: "assert.equal(require('./build').build('web'),'built web')",
      target_b_build: "assert.equal(require('./build').build('mobile'),'built mobile')",
      package_tests: "require('./test')",
    },
  },
  {
    id: 'shared-root-cause',
    task: 'Identifiers longer than five characters are rejected by the route but still pass import and UI paths. Repair the shared validator, cover every path and edge, and run the suite.',
    files: {
      'validator.js': "exports.valid=(value)=>typeof value==='string'&&value.trim().length>0;\n",
      'paths.js': "const {valid}=require('./validator');exports.route=(v)=>valid(v)&&v.length<=5;exports.importPath=(v)=>valid(v);exports.ui=(v)=>valid(v);\n",
      'test.js': "const assert=require('node:assert/strict');const p=require('./paths');for(const f of [p.route,p.importPath,p.ui]){assert.equal(f('abc'),true);assert.equal(f('abcdef'),false);assert.equal(f('   '),false)}\n",
    },
    solution: {
      'validator.js': "exports.valid=(value)=>typeof value==='string'&&value.trim().length>0&&value.length<=5;\n",
      'paths.js': "const {valid}=require('./validator');exports.route=(v)=>valid(v);exports.importPath=(v)=>valid(v);exports.ui=(v)=>valid(v);\n",
    },
    checks: {
      shared_validator: "assert.equal(require('./validator').valid('abcdef'),false)",
      route_path: "assert.equal(require('./paths').route('abcdef'),false)",
      import_path: "assert.equal(require('./paths').importPath('abcdef'),false)",
      ui_path: "assert.equal(require('./paths').ui('abcdef'),false)",
      edge_cases: "const v=require('./validator').valid;assert.equal(v(''),false);assert.equal(v('   '),false);assert.equal(v('abcde'),true)",
      suite: "require('./test')",
    },
  },
];

function writeFiles(directory, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function createFixture(testCase, directory) {
  const fixture = fixtures.find((item) => item.id === testCase);
  if (!fixture) throw new Error(`unknown fixture: ${testCase}`);
  fs.mkdirSync(directory, { recursive: true });
  writeFiles(directory, fixture.files);
  return fixture;
}

function applyKnownSolution(fixture, directory) {
  writeFiles(directory, fixture.solution);
}

function evaluateFixture(fixture, directory) {
  const completed = [];
  const failures = [];
  for (const [key, source] of Object.entries(fixture.checks)) {
    const prelude = "const assert=require('node:assert/strict');const fs=require('node:fs');const cp=require('node:child_process');";
    const result = spawnSync(process.execPath, ['-e', prelude + source], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (result.status === 0) completed.push(key);
    else failures.push({ check: key, resolved: false, reported: false, output: `${result.stdout}${result.stderr}`.slice(0, 1000) });
  }
  return { completed, failures };
}

module.exports = { applyKnownSolution, createFixture, evaluateFixture, fixtures };
