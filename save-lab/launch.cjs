'use strict';
// Offline runtime discovery. No install, registry changes, shell execution, or save writes.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ROOT = __dirname;
const CONFIG_NAME = 'save-lab.local.json';

function readConfig(root = ROOT) {
  const file = path.join(root, CONFIG_NAME);
  if (!fs.existsSync(file)) return {};
  if (fs.statSync(file).size > 4096) throw Error(CONFIG_NAME + ' is larger than 4 KiB');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw Error(CONFIG_NAME + ': invalid JSON. Use forward slashes in Windows paths. ' + error.message); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(CONFIG_NAME + ' must be a JSON object');
  for (const [key, val] of Object.entries(value)) {
    if (!['python', 'saveDirectory'].includes(key) || typeof val !== 'string' || /[\r\n\0]/.test(val)) throw Error(CONFIG_NAME + ': unsupported key or invalid value: ' + key);
  }
  return value;
}

function pathExecutables(name, env = process.env, platform = process.platform, exists = fs.existsSync) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const dirs = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':');
  const filename = platform === 'win32' ? name + '.exe' : name;
  const result = [];
  for (let dir of dirs) {
    dir = dir.replace(/^"|"$/g, '');
    if (!dir) continue;
    const full = api.join(dir, filename);
    // Store aliases can open the Store instead of running a probe.
    if (platform === 'win32' && /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(full)) continue;
    if (exists(full)) result.push(full);
  }
  return result;
}

function candidates(config = {}, env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const spawn = options.spawnSync || cp.spawnSync;
  const exists = options.exists || fs.existsSync;
  const root = options.root || ROOT;
  const api = platform === 'win32' ? path.win32 : path.posix;
  const out = [];
  function add(executable, args, source) {
    if (typeof executable !== 'string' || !executable.trim()) return;
    executable = executable.trim();
    if (/[\r\n\0"]/.test(executable)) return;
    const key = (platform === 'win32' ? executable.toLowerCase() : executable) + '|' + args.join('|');
    if (!out.some(x => x.key === key)) out.push({executable, args, source, key});
  }
  for (const [value, source] of [[env.SAVE_LAB_PYTHON, 'SAVE_LAB_PYTHON'], [config.python, CONFIG_NAME]]) {
    if (value && value.trim()) add(api.isAbsolute(value) ? value : api.resolve(root, value), [], source);
  }
  for (const name of ['python', 'python3']) for (const exe of pathExecutables(name, env, platform, exists)) add(exe, [], 'PATH');
  if (platform === 'win32') {
    const pyPaths = pathExecutables('py', env, platform, exists);
    for (const py of pyPaths) {
      const r = spawn(py, ['-0p'], {encoding:'utf8', timeout:10000, windowsHide:true, shell:false});
      for (const line of ((r.stdout || '') + '\n' + (r.stderr || '')).split(/\r?\n/)) {
        const found = line.match(/([A-Za-z]:[\\/].*?[\\/]python(?:w)?\.exe)\s*$/i);
        if (found) add(found[1], [], 'py registered runtime');
      }
      // Resolve py only after real PATH executables. A broken default is not fatal.
      for (const tag of ['-3', '-3.14', '-3.13', '-3.12', '-3.11', '-3.10']) add(py, [tag], 'py ' + tag);
    }
  }
  return out;
}

function probePython(candidate, options = {}) {
  const spawn = options.spawnSync || cp.spawnSync;
  const lines = [
    'import json,sys,sqlite3',
    'assert sys.version_info >= (3,10), "Python 3.10 or newer is required"',
    'con=sqlite3.connect(":memory:")',
    'assert con.execute("select json_valid(\'{}\')").fetchone()[0] == 1, "SQLite JSON support is required"',
    'con.close()',
  ];
  if (!options.headless) lines.push('import tkinter', 't=tkinter.Tcl()', 't.loadtk()', 't.withdraw()', 'tk_version=t.call("info","patchlevel")', 't.destroy()');
  lines.push('print(json.dumps({"executable":sys.executable,"version":sys.version.split()[0],"tk":' + (options.headless ? 'None' : 'tk_version') + '}))');
  const r = spawn(candidate.executable, [...candidate.args, '-X', 'utf8', '-c', lines.join('\n')], {
    encoding:'utf8', timeout:12000, maxBuffer:1024*1024, windowsHide:true, shell:false,
    env:options.env || process.env,
  });
  if (r.error || r.status !== 0) return {ok:false, error:String(r.error?.message || r.stderr || r.stdout || 'probe failed').trim().slice(-1600)};
  try {
    const result = JSON.parse(r.stdout.trim());
    if (!result.executable || typeof result.executable !== 'string') throw Error('missing executable');
    return {ok:true, ...result};
  } catch (error) { return {ok:false, error:'Unexpected Python probe response: ' + error.message}; }
}

function selectPython(list, probe = probePython) {
  const attempts = [];
  for (const candidate of list) {
    const result = probe(candidate);
    attempts.push({source:candidate.source, executable:candidate.executable, args:candidate.args, ...result});
    if (result.ok) return {selected:result, attempts};
  }
  return {selected:null, attempts};
}

function runApp(executable, env, options = {}) {
  const spawn = options.spawnSync || cp.spawnSync;
  const r = spawn(executable, ['-X', 'utf8', path.join(options.root || ROOT, 'save_lab.py'), 'gui'], {
    cwd:options.root || ROOT, env, stdio:'inherit', windowsHide:false, shell:false,
  });
  // Do not reopen the app using another runtime after application code has run.
  if (r.error) { (options.error || console.error)(r.error.message); return 2; }
  return typeof r.status === 'number' ? r.status : 2;
}

function main(argv = process.argv.slice(2), options = {}) {
  const out = options.log || console.log;
  const err = options.error || console.error;
  const env = {...(options.env || process.env)};
  const root = options.root || ROOT;
  if (Number(process.versions.node.split('.')[0]) < 18) { err('Node.js 18 or newer is required. No save file was changed.'); return 2; }
  const localEnv = path.join(root, '.env');
  if (fs.existsSync(localEnv)) {
    for (const line of fs.readFileSync(localEnv, 'utf8').split(/\r?\n/)) {
      const entry = line.trim().match(/^(SAVE_LAB_(?:NODE|PYTHON|SAVE_DIR|CACHE_DIR))\s*=\s*(.*)$/);
      if (!entry || entry[1] in env) continue;
      const value = entry[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value) env[entry[1]] = path.resolve(root, value);
    }
  }
  if (!('SAVE_LAB_NODE' in env)) env.SAVE_LAB_NODE = process.execPath;
  const diagnose = argv.includes('--diagnose');
  const headless = argv.includes('--headless');
  if (argv.some(x => !['--gui','--diagnose','--headless'].includes(x)) || (headless && !diagnose)) {
    err('Usage: node launch.cjs [--gui | --diagnose [--headless]]'); return 2;
  }
  let config;
  try { config = readConfig(root); }
  catch (error) { err(error.message); return 2; }
  if (!env.SAVE_LAB_SAVE_DIR && config.saveDirectory?.trim()) {
    const directory = path.resolve(root, config.saveDirectory.trim());
    try { if (!fs.statSync(directory).isDirectory()) throw Error('not a directory'); }
    catch { err('Configured saveDirectory does not exist: ' + directory); return 2; }
    env.SAVE_LAB_SAVE_DIR = directory;
  }
  const list = candidates(config, env, options);
  const resolved = selectPython(list, c => probePython(c, {...options, headless, env}));
  const report = {node:process.execPath, nodeVersion:process.version, configFile:path.join(root,CONFIG_NAME), mode:headless?'headless':'GUI', ...resolved};
  if (diagnose) out(JSON.stringify(report, null, 2));
  else {
    for (const a of resolved.attempts.filter(x => !x.ok)) out('[Skipped] ' + a.executable + ' ' + a.args.join(' ') + '\n' + a.error);
    if (resolved.selected) out('[Using Python] ' + resolved.selected.executable + ' (' + resolved.selected.version + ', Tk ' + resolved.selected.tk + ')');
  }
  if (!resolved.selected) {
    err('No working Python runtime was found. Existing installations were not changed.');
    err('Copy save-lab.config.example.json to save-lab.local.json and set python to a working python.exe path.');
    err('Run Diagnose-Save-Lab.cmd for details. No save file was changed.');
    return 2;
  }
  if (diagnose) return 0;
  return runApp(resolved.selected.executable, env, {...options,root,error:err});
}
module.exports = {readConfig,pathExecutables,candidates,probePython,selectPython,runApp,main};
if (require.main === module) process.exitCode = main();
