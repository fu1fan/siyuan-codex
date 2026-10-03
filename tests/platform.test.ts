import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {cliLaunch,cliSearchDirectories,expandLocalPath,findBinary,sameLocalPath,type PlatformFiles,type PlatformRuntime} from '../src/platform';
import {stopProcessTree} from '../src/process-tree';
import {CodexClient,defaults} from '../src/codex';
import {droppedIDs} from '../src/context';

function fixture(platform:NodeJS.Platform,env:NodeJS.ProcessEnv={}){
  const r:PlatformRuntime={platform,home:platform==='win32'?'C:\\Users\\测试用户':'/home/test',execPath:platform==='win32'?'C:\\SiYuan\\SiYuan.exe':'/opt/SiYuan/SiYuan',env};
  const paths=new Set<string>(),nonExecutable=new Set<string>(),links=new Map<string,string>(),dirs=new Map<string,string[]>();
  const key=(v:string)=>platform==='win32'?v.replace(/\//g,'\\').toLowerCase():v;
  const f:PlatformFiles={file:v=>paths.has(key(v)),executable:v=>paths.has(key(v))&&!nonExecutable.has(key(v)),realpath:v=>links.get(key(v))||v,directories:v=>dirs.get(key(v))||[]};
  return {r,f,add:(...v:string[])=>v.forEach(p=>paths.add(key(p))),notExecutable:(v:string)=>nonExecutable.add(key(v)),link:(v:string,to:string)=>links.set(key(v),to),dir:(v:string,children:string[])=>dirs.set(key(v),children)};
}
test('platform paths expand quoted home paths, preserve UNC and distinguish drive-relative input',()=>{
  const {r}=fixture('win32');
  assert.equal(expandLocalPath(' "~\\中文 项目" ',r),'C:\\Users\\测试用户\\中文 项目');
  assert.equal(expandLocalPath('~/project',r),'C:\\Users\\测试用户\\project');
  assert.equal(expandLocalPath('"\\\\server\\share\\项目"',r),'\\\\server\\share\\项目');
  assert.equal(sameLocalPath('C:\\Notes\\','c:/notes','win32'),true);
  assert.equal(sameLocalPath('\\\\server\\share\\','//SERVER/share','win32'),true);
  assert.equal(sameLocalPath('C:','C:\\','win32'),false);
  assert.equal(sameLocalPath('/Notes','/notes','linux'),false);
  assert.equal(sameLocalPath('/Notes/','/Notes','darwin'),true);
  assert.equal(sameLocalPath('/notes/a/../b','/notes/b','linux'),true);
  assert.equal(expandLocalPath('~\\literal',fixture('linux').r),'~\\literal');
});
test('Windows discovers npm shims outside GUI PATH and invokes Node with literal arguments',()=>{
  const s=fixture('win32',{Path:'"C:\\Program Files\\nodejs";.;',APPDATA:'C:\\Users\\测试用户\\AppData\\Roaming',CODEX_HOME:'D:\\Codex 数据'});
  const shim='C:\\Users\\测试用户\\AppData\\Roaming\\npm\\codex.cmd',js='C:\\Users\\测试用户\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
  s.add(shim,js,'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(findBinary('',s.r,s.f),shim);
  assert.equal(findBinary('codex',s.r,s.f),shim);
  const args=['app-server','中文 & $(touch never)'],launch=cliLaunch('',args,s.r,s.f);
  assert.equal(launch.command,'C:\\Program Files\\nodejs\\node.exe');assert.deepEqual(launch.args,[js,...args]);
  assert.deepEqual(Object.keys(launch.env).filter(k=>k.toLowerCase()==='path'),['Path']);
  assert.equal(launch.env.CODEX_HOME,'D:\\Codex 数据');assert.equal(s.r.env.Path,'"C:\\Program Files\\nodejs";.;');
  assert.ok(!launch.env.Path!.split(';').includes('.'));assert.ok(!launch.env.Path!.includes('/opt/homebrew'));
});
test('explicit Windows executable, npm PowerShell shim and Electron Node fallback need no shell',()=>{
  const s=fixture('win32');const binary='D:\\工具 & 空格\\codex.exe';
  const direct=cliLaunch('"'+binary+'"',['app-server'],s.r,s.f);assert.equal(direct.command,binary);assert.deepEqual(direct.args,['app-server']);
  const shim='D:\\npm\\codex.ps1',js='D:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';s.add(shim,js);
  const launch=cliLaunch(shim,['app-server'],s.r,s.f);assert.equal(launch.command,s.r.execPath);assert.equal(launch.env.ELECTRON_RUN_AS_NODE,'1');assert.deepEqual(launch.args,[js,'app-server']);
  assert.throws(()=>cliLaunch('D:\\custom.cmd',['app-server'],s.r,s.f),/原生可执行文件/);
  assert.equal(findBinary(binary,s.r,s.f),binary,'explicit paths never fall back to another install');
});
test('Windows native CLI, WinGet and case-insensitive PATH keys work without Unix paths',()=>{
  const s=fixture('win32',{pAtH:'C:\\Tools;C:/TOOLS;',LOCALAPPDATA:'C:\\Users\\test\\AppData\\Local'});
  s.add('C:\\Tools\\codex.exe');assert.equal(findBinary('',s.r,s.f),'C:\\Tools\\codex.exe');
  const dirs=cliSearchDirectories(s.r,s.f);assert.equal(dirs.filter(d=>sameLocalPath(d,'C:\\Tools','win32')).length,1);
  const launch=cliLaunch('',[],s.r,s.f);assert.ok('pAtH' in launch.env);assert.equal('PATH' in launch.env,false);
  const winget='C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links\\codex.exe';const w=fixture('win32',s.r.env);w.add(winget);assert.equal(findBinary('',w.r,w.f),winget);
  const n=fixture('win32',{NVM_HOME:'C:\\Node versions'});n.dir('C:\\Node versions',['v9.0.0','v24.0.0']);n.add('C:\\Node versions\\v24.0.0\\codex.exe');assert.equal(findBinary('',n.r,n.f),'C:\\Node versions\\v24.0.0\\codex.exe');
});
test('macOS and Linux discover GUI installs and skip non-executable PATH candidates',()=>{
  const mac=fixture('darwin',{PATH:'/bad:/custom:relative'});mac.add('/bad/codex','/opt/homebrew/bin/codex');mac.notExecutable('/bad/codex');assert.equal(findBinary('',mac.r,mac.f),'/opt/homebrew/bin/codex');
  const linux=fixture('linux',{PATH:'',XDG_DATA_HOME:'/data'});linux.dir('/data/mise/installs/node',['v9.0.0','v24.0.0']);linux.add('/data/mise/installs/node/v24.0.0/bin/codex','/data/mise/installs/node/v9.0.0/bin/codex');
  assert.equal(findBinary('',linux.r,linux.f),'/data/mise/installs/node/v24.0.0/bin/codex');assert.ok(!cliSearchDirectories(linux.r,linux.f).includes('/opt/homebrew/bin'));
  linux.add('/home/test/.local/bin/codex');assert.equal(findBinary('',linux.r,linux.f),'/home/test/.local/bin/codex');
});
test('POSIX npm symlinks use their own Node installation when GUI PATH omits it',()=>{
  const s=fixture('darwin',{PATH:'/usr/bin'}),bin='/home/test/.nvm/versions/node/v24.0.0/bin';s.dir('/home/test/.nvm/versions/node',['v24.0.0']);s.add(bin+'/codex',bin+'/node');
  const js='/home/test/.nvm/versions/node/v24.0.0/lib/node_modules/@openai/codex/bin/codex.js';s.link(bin+'/codex',js);
  const launch=cliLaunch('', ['app-server'],s.r,s.f);assert.equal(launch.command,bin+'/node');assert.deepEqual(launch.args,[js,'app-server']);assert.ok(launch.env.PATH!.split(':').includes(bin));
});
test('block-reference and gutter drags compare workspace identities on their platform',()=>{
  const id='20261001120000-parent1',transfer=(value:string)=>({types:['application/siyuan-block-ref'],getData:()=>JSON.stringify({ids:[id],workspaceDir:value})});
  assert.deepEqual(droppedIDs(transfer('C:/Notes/'),'c:\\notes','win32'),[id]);
  assert.throws(()=>droppedIDs(transfer('/Notes'),'/notes','linux'),/另一个/);
  const gutter='application/siyuan-gutternodeparagraph\u200b\u200b'+id+'\u200bC:/Notes/';
  assert.deepEqual(droppedIDs({types:[gutter],getData:()=>''},'c:\\notes','win32'),[id]);
});
test('Windows disposal terminates the full tree and falls back if taskkill fails',()=>{
  const calls:any[]=[];let killed=false;const child:any={pid:123,kill:()=>{killed=true;}};
  const execute:any=(...args:any[])=>{calls.push(args);args[3](null);};
  stopProcessTree(child,'win32',{SYSTEMROOT:'C:\\Windows'},execute);
  assert.equal(calls[0][0],'C:\\Windows\\System32\\taskkill.exe');assert.deepEqual(calls[0][1],['/PID','123','/T','/F']);assert.equal(calls[0][2].windowsHide,true);assert.equal(killed,false);
  stopProcessTree(child,'win32',{},((...args:any[])=>args[3](Error('failed'))) as any);assert.equal(killed,true);
});
test('POSIX disposal signals the process group even if its launcher exits first',()=>{
  const signals:any[]=[];const original=globalThis.setTimeout;let later!:()=>void;
  try{globalThis.setTimeout=((fn:()=>void)=>{later=fn;return 1;}) as any;
    stopProcessTree({pid:456,exitCode:0,kill(){throw Error('group should be used');}} as any,'linux',{},undefined,((...args:any[])=>signals.push(args)) as any);
    assert.deepEqual(signals,[[-456,'SIGTERM']]);later();assert.deepEqual(signals,[[-456,'SIGTERM'],[-456,'SIGKILL']]);
  }finally{globalThis.setTimeout=original;}
});
test('real transport starts a JS fixture from a path containing spaces, Chinese and shell characters',async()=>{
  const root=await mkdtemp(join(tmpdir(),'codex 中文 & $-'));const binary=join(root,'fixture & name.cjs');
  await copyFile(new URL('./fake-codex.cjs',import.meta.url),binary);const client=new CodexClient(5000);
  try{await client.start({...defaults,binary,cwd:root});assert.deepEqual(await client.request('echo',{value:'中文 & $literal'}),{value:'中文 & $literal'});}finally{
    const child=(client as any).child,closed=child&&child.exitCode===null&&child.signalCode===null?once(child,'close'):Promise.resolve();client.dispose();await closed;
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
});
