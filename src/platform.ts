import {accessSync,constants,realpathSync,readdirSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {posix,win32} from 'node:path';
import {sameLocalPath} from './path-identity';
export {sameLocalPath} from './path-identity';

export type PlatformRuntime={platform:NodeJS.Platform;home:string;env:NodeJS.ProcessEnv;execPath:string};
export type PlatformFiles={executable:(path:string)=>boolean;file:(path:string)=>boolean;realpath:(path:string)=>string;directories:(path:string)=>string[]};
export const runtime=():PlatformRuntime=>({platform:process.platform,home:homedir(),env:process.env,execPath:process.execPath});
export const platformPath=(platform:NodeJS.Platform=process.platform)=>platform==='win32'?win32:posix;
export function environmentValue(env:NodeJS.ProcessEnv,name:string,platform:NodeJS.Platform=process.platform){
  const key=platform==='win32'?Object.keys(env).find(k=>k.toLowerCase()===name.toLowerCase()):name;
  return key?env[key]:undefined;
}
function filesFor(platform:NodeJS.Platform):PlatformFiles{
  const file=(path:string)=>{try{return statSync(path).isFile();}catch{return false;}};
  return {file,executable:path=>{if(!file(path))return false;try{accessSync(path,platform==='win32'?constants.F_OK:constants.X_OK);return true;}catch{return false;}},realpath:realpathSync,directories:path=>{try{return readdirSync(path,{withFileTypes:true}).filter(d=>d.isDirectory()||d.isSymbolicLink()).map(d=>d.name);}catch{return [];}}};
}
export function expandLocalPath(value:string,r=runtime()){
  const p=platformPath(r.platform);let path=value.trim();
  // A path copied from a terminal/dialog may have outer quotes. Never parse it as a command.
  if(path.length>1&&((path.startsWith('"')&&path.endsWith('"'))||(path.startsWith("'")&&path.endsWith("'"))))path=path.slice(1,-1);
  if(path==='~')return r.home;
  if(path.startsWith('~/')||(r.platform==='win32'&&path.startsWith('~\\')))return p.join(r.home,path.slice(2));
  return path;
}
export function cliSearchDirectories(r=runtime(),files:PlatformFiles=filesFor(r.platform)){
  const p=platformPath(r.platform),env=(key:string)=>environmentValue(r.env,key,r.platform);
  const dirs=(env('PATH')||'').split(p.delimiter).map(value=>expandLocalPath(value,r));
  const add=(...values:(string|undefined)[])=>dirs.push(...values.filter((v):v is string=>!!v));
  const under=(key:string,...parts:string[])=>{const root=env(key);return root?p.join(root,...parts):undefined;};
  if(r.platform==='win32'){
    add(under('APPDATA','npm'),under('LOCALAPPDATA','Microsoft','WinGet','Links'),under('LOCALAPPDATA','Programs','nodejs'),under('ProgramFiles','nodejs'),env('NVM_SYMLINK'),env('NVM_HOME'),env('FNM_MULTISHELL_PATH'),env('PNPM_HOME'),p.join(r.home,'scoop','shims'),p.join(r.home,'.local','bin'),p.join(r.home,'.bun','bin'),under('VOLTA_HOME','bin'),p.join(r.home,'.volta','bin'));
  }else{
    add(p.join(r.home,'.local','bin'),p.join(r.home,'bin'),p.join(r.home,'.npm-global','bin'),p.join(r.home,'.bun','bin'),under('VOLTA_HOME','bin'),p.join(r.home,'.volta','bin'),env('FNM_MULTISHELL_PATH'),env('PNPM_HOME'));
    if(r.platform==='darwin')add('/opt/homebrew/bin');
    add('/usr/local/bin','/usr/bin','/bin');
    if(r.platform==='linux')add('/snap/bin');
  }
  const mise=env('MISE_DATA_DIR')||(r.platform==='win32'?under('LOCALAPPDATA','mise'):under('XDG_DATA_HOME','mise'))||p.join(r.home,'.local','share','mise');
  const roots=[{root:p.join(mise,'installs','node'),suffix:r.platform==='win32'?[]:['bin']},
    {root:p.join(env('NVM_DIR')||p.join(r.home,'.nvm'),'versions','node'),suffix:['bin']},
    {root:p.join(env('FNM_DIR')||(r.platform==='darwin'?p.join(r.home,'Library','Application Support','fnm'):r.platform==='win32'?under('LOCALAPPDATA','fnm')||p.join(r.home,'.fnm'):under('XDG_DATA_HOME','fnm')||p.join(r.home,'.local','share','fnm')),'node-versions'),suffix:['installation',...(r.platform==='win32'?[]:['bin'])]}];
  if(r.platform==='win32'&&env('NVM_HOME'))roots.push({root:env('NVM_HOME')!,suffix:[]});
  for(const {root,suffix} of roots)for(const version of files.directories(root).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})))add(p.join(root,version,...suffix));
  // Do not let an empty/relative PATH entry select a binary in the note/project directory.
  return dirs.filter((dir,i)=>p.isAbsolute(dir)&&!dirs.slice(0,i).some(previous=>sameLocalPath(previous,dir,r.platform)));
}
export function findBinary(value:string,r=runtime(),files:PlatformFiles=filesFor(r.platform)){
  const p=platformPath(r.platform),input=expandLocalPath(value,r);
  if(input&&(p.isAbsolute(input)||/[\\/]/.test(input)))return input;
  const names=input?[input]:r.platform==='win32'?['codex.exe','codex.cmd','codex.ps1','codex']:['codex'];
  if(r.platform==='win32'&&input&&!p.extname(input))names.push(input+'.exe',input+'.cmd',input+'.ps1');
  for(const dir of cliSearchDirectories(r,files))for(const name of names){const path=p.join(dir,name);if(files.executable(path))return path;}
  return input||(r.platform==='win32'?'codex.exe':'codex');
}
export type CliLaunch={binary:string;command:string;args:string[];env:NodeJS.ProcessEnv};
export function cliLaunch(value:string,args:string[],r=runtime(),files:PlatformFiles=filesFor(r.platform)):CliLaunch{
  const p=platformPath(r.platform),binary=findBinary(value,r,files),env={...r.env};let command=binary,entry=binary;
  if(r.platform==='win32'&&/\.(cmd|bat|ps1)$/i.test(binary)){
    // npm's shim cannot be executed with shell:false. Invoke the known JS entry directly,
    // retaining the official launcher's platform-package and package-manager behavior.
    entry=p.join(p.dirname(binary),'node_modules','@openai','codex','bin','codex.js');
    if(!/^codex\.(cmd|ps1)$/i.test(p.basename(binary))||!files.file(entry))throw Error('此脚本入口无法直接启动。请填写 Codex 原生可执行文件或 npm 的 codex.cmd / codex.ps1 完整路径。');
  }
  const extra:string[]=[p.dirname(binary)];
  try{entry=files.realpath(entry);extra.push(p.dirname(entry));}catch{}
  let launchArgs=[...args];
  if(/\.(?:mjs|cjs|js)$/i.test(entry)){
    const nearby=[p.join(p.dirname(binary),r.platform==='win32'?'node.exe':'node'),p.join(p.dirname(entry),'..','..','..','..',...(r.platform==='win32'?[]:['..','bin']),r.platform==='win32'?'node.exe':'node')];
    command=nearby.find(file=>files.executable(file))||findBinary(r.platform==='win32'?'node.exe':'node',r,files);
    if(!p.isAbsolute(command)){command=r.execPath;env.ELECTRON_RUN_AS_NODE='1';}
    extra.unshift(p.dirname(command));launchArgs=[entry,...args];
  }
  const pathKeys=Object.keys(env).filter(key=>r.platform==='win32'?key.toLowerCase()==='path':key==='PATH');
  const pathKey=pathKeys[0]||'PATH';for(const key of pathKeys)delete env[key];
  env[pathKey]=[...extra,...cliSearchDirectories(r,files)].filter((dir,i,all)=>p.isAbsolute(dir)&&!all.slice(0,i).some(other=>sameLocalPath(dir,other,r.platform))).join(p.delimiter);
  return {binary,command,args:launchArgs,env};
}
