'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const L = require('../launch.cjs');
let count = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); count++; }
function temp(fn) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'save-lab-launch-')); try { fn(root); } finally { fs.rmSync(root, {recursive:true, force:true}); } }
function writeConfig(root, value) { fs.writeFileSync(path.join(root, 'save-lab.local.json'), typeof value === 'string' ? value : JSON.stringify(value)); }
const good = exe => ({status:0, stdout:JSON.stringify({executable:exe, version:'3.13.3', tk:'8.6.14'}), stderr:''});
const bad = message => ({status:1, stdout:'', stderr:message});

test('PATH discovery skips Store aliases and supports quoted spaced Unicode paths', () => {
 const env = {Path:'C:\\Users\\user\\AppData\\Local\\Microsoft\\WindowsApps;"C:\\日本語 User\\Python313";C:\\Python314'};
 assert.deepEqual(L.pathExecutables('python', env, 'win32', () => true), ['C:\\日本語 User\\Python313\\python.exe','C:\\Python314\\python.exe']);
});
test('explicit env and config precede PATH and py registry, with case-insensitive deduplication', () => {
 const calls = [];
 const list = L.candidates({python:'C:\\設定 Folder\\Python313\\python.exe'}, {SAVE_LAB_PYTHON:'C:\\Custom\\python.exe',PATH:'C:\\Python313;C:\\Tools'}, {platform:'win32', exists:p => p.endsWith('python.exe') || p === 'C:\\Tools\\py.exe', spawnSync:(exe,args,opts) => {calls.push({exe,args,opts});return {status:0,stdout:' -V:3.14 * C:\\Python314\\python.exe\r\n -V:3.13 C:\\PYTHON313\\python.exe\r\n -V:3.12 C:\\Program Files\\Python312\\python.exe'};}});
 assert.equal(list[0].source,'SAVE_LAB_PYTHON'); assert.equal(list[1].source,'save-lab.local.json');
 assert.equal(list[1].executable,'C:\\設定 Folder\\Python313\\python.exe');
 assert.ok(list.findIndex(x=>x.source==='PATH') < list.findIndex(x=>x.source==='py registered runtime'));
 assert.equal(list.filter(x=>x.executable.toLowerCase()==='c:\\python313\\python.exe').length,1);
 assert.ok(list.some(x=>x.executable==='C:\\Program Files\\Python312\\python.exe'));
 assert.equal(calls.length,1); assert.deepEqual(calls[0].args,['-0p']); assert.equal(calls[0].opts.shell,false);
});
test('Windows and POSIX candidate paths are independent of the host filesystem', () => {
 for(const [platform, api, root] of [['win32',path.win32,'C:\\Save Lab'],['linux',path.posix,'/tmp/save-lab']]) {
  const filename='日本語 Python & $(not-a-command).exe';
  const absolute=api.join(root,'absolute',filename);const relative=api.join('relative',filename);
  const list=L.candidates({python:relative},{SAVE_LAB_PYTHON:absolute},{root,platform,exists:()=>false,spawnSync:()=>{throw Error('unexpected process');}});
  assert.deepEqual(list.map(c=>c.executable),[absolute,api.join(root,relative)]);
  assert.deepEqual(list.map(c=>c.args),[[],[]]);
 }
});
test('broken 3.14 probe falls back to working 3.13 and stops', () => {
 const list = ['C:\\Python314\\python.exe','C:\\Python313\\python.exe','C:\\Python312\\python.exe'].map(executable=>({executable,args:[],source:'PATH'}));
 const calls=[]; const result = L.selectPython(list,c=>L.probePython(c,{spawnSync:(exe,args,opts)=>{calls.push(exe);assert.equal(opts.shell,false);assert.match(args.at(-1),/t\.loadtk\(\)/);return exe.includes('314')?bad('TclError: init.tcl not found'):good(exe);}}));
 assert.equal(result.selected.executable,list[1].executable);assert.deepEqual(calls,list.slice(0,2).map(x=>x.executable));assert.equal(result.attempts[0].ok,false);
});
test('probe requires modern Python, SQLite JSON, and GUI load rather than import alone', () => {
 L.probePython({executable:'/python',args:[]},{spawnSync:(exe,args,opts)=>{const code=args.at(-1);assert.match(code,/sys\.version_info >= \(3,10\)/);assert.match(code,/sqlite3\.connect/);assert.match(code,/json_valid/);assert.match(code,/t\.loadtk\(\)/);assert.equal(opts.timeout,12000);return good(exe);}});
 for(const r of [bad('broken sqlite'),{status:null,error:new Error('timeout')},{status:0,stdout:'unexpected output'},{status:0,stdout:'{}'}]) assert.equal(L.probePython({executable:'/python',args:[]},{spawnSync:()=>r}).ok,false);
});
test('config supports BOM, spaces and Unicode and rejects malformed/unknown/oversized values', () => temp(root => {
 assert.deepEqual(L.readConfig(root),{});
 const valid={python:'C:/日本語 User/Python313/python.exe',saveDirectory:'./セーブ Folder'};
 writeConfig(root,'\uFEFF'+JSON.stringify(valid));assert.deepEqual(L.readConfig(root),valid);
 for(const input of ['{','null','[]','{"python":42}','{"other":"value"}','{"python":"a\\nb"}','{"saveDirectory":null}',' '.repeat(4097)]) {writeConfig(root,input);assert.throws(()=>L.readConfig(root));}
}));
test('invalid config and missing save directory fail before any interpreter runs', () => temp(root => {
 let calls=0;const options={root,env:{},platform:'win32',log:()=>{},error:()=>{},spawnSync:()=>{calls++;return good('/python');}};
 writeConfig(root,'{');assert.equal(L.main([],options),2);
 writeConfig(root,{saveDirectory:'missing'});assert.equal(L.main([],options),2);assert.equal(calls,0);
}));
test('no candidates reports actionable failure without launching', () => temp(root => {
 const errors=[];assert.equal(L.main([],{root,env:{},platform:'win32',exists:()=>false,spawnSync:()=>{throw Error('unexpected process');},log:()=>{},error:s=>errors.push(s)}),2);
 assert.ok(errors.some(s=>s.includes('No working Python runtime')));assert.ok(errors.some(s=>s.includes('save-lab.local.json')));
}));
test('app failure does not probe/relaunch another runtime; configured paths remain literal argv', () => temp(root => {
 const executable=path.join(root,'日本語 Python & $(not-a-command).exe');const savedir=path.join(root,'セーブ Folder');fs.mkdirSync(savedir);writeConfig(root,{python:executable,saveDirectory:savedir});
 // These are real temp paths, so use native path rules. Keep a fallback Python
 // candidate without inventing a Windows py launcher/registry subprocess.
 const calls=[];const options={root,env:{PATH:path.join(root,'fallback')},platform:process.platform,exists:p=>/^python3?(\.exe)?$/.test(path.basename(p)),log:()=>{},error:()=>{},spawnSync:(exe,args,opts)=>{calls.push({exe,args,opts});assert.equal(opts.shell,false);return args.includes('-c')?good(exe):{status:17};}};
 assert.ok(L.candidates({python:executable},options.env,options).length>1);
 assert.equal(L.main([],options),17);assert.equal(calls.length,2);assert.equal(calls[0].exe,executable);assert.equal(calls[1].exe,executable);assert.deepEqual(calls[1].args,['-X','utf8',path.join(root,'save_lab.py'),'gui']);assert.equal(calls[1].opts.env.SAVE_LAB_SAVE_DIR,savedir);
}));
test('app signals and spawn errors return failure without fallback', () => {
 for(const result of [{status:null,signal:'SIGTERM'},{status:null,error:new Error('spawn failed')}]) {let calls=0;assert.equal(L.runApp('/python',{}, {spawnSync:()=>{calls++;return result;},error:()=>{}}),2);assert.equal(calls,1);}
});
test('diagnosis does not launch app and headless is never accepted for GUI launch', () => temp(root => {
 writeConfig(root,{python:'/test/python'});let calls=0;const reports=[];const opts={root,env:{},platform:'linux',log:s=>reports.push(s),error:()=>{},spawnSync:(exe,args)=>{calls++;assert.ok(args.includes('-c'));assert.doesNotMatch(args.at(-1),/loadtk/);return good(exe);}};
 assert.equal(L.main(['--headless'],opts),2);assert.equal(calls,0);
 assert.equal(L.main(['--diagnose','--headless'],opts),0);assert.equal(calls,1);assert.equal(JSON.parse(reports[0]).mode,'headless');
}));
if (process.platform !== 'win32') test('real installed Python validates SQLite and reports unavailable display accurately', () => {
 const r=spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'});
 if(r.status!==0){console.log('SKIP real Python unavailable');return;}
 const candidate={executable:r.stdout.trim(),args:[]};const headless=L.probePython(candidate,{headless:true});assert.equal(headless.ok,true,headless.error);
 const env={...process.env};delete env.DISPLAY;delete env.WAYLAND_DISPLAY;
 const gui=L.probePython(candidate,{env});assert.equal(gui.ok,false);assert.match(gui.error,/display|tkinter|TclError/i);
});
console.log(`${count} launcher regression groups passed`);
