import {spawn} from 'node:child_process';
import {accessSync,constants,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute} from 'node:path';
import {CodexClient,defaults} from './codex';
import {cliLaunch,findBinary} from './platform';
import {stopProcessTree} from './process-tree';

export type CheckState='waiting'|'checking'|'success'|'error'|'warning';
export type CliCheck={id:'path'|'version'|'connection'|'account';state:CheckState;detail:string};
export type CliDetection={binary:string;checks:CliCheck[];connected:boolean};
export const initialChecks=():CliCheck[]=>[
  {id:'path',state:'waiting',detail:'等待检测'},
  {id:'version',state:'waiting',detail:'等待检测'},
  {id:'connection',state:'waiting',detail:'等待检测'},
  {id:'account',state:'waiting',detail:'等待检测'}
];
const cancelled=()=>new Error('检测已取消。');
function readVersion(binary:string,signal?:AbortSignal,timeout=4000):Promise<string>{
  if(signal?.aborted)return Promise.reject(cancelled());
  const launch=cliLaunch(binary,['--version']);
  return new Promise((resolve,reject)=>{
    const child=spawn(launch.command,launch.args,{env:launch.env,cwd:homedir(),stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true,detached:process.platform!=='win32'});
    let output='',settled=false;
    const finish=(error?:Error,version='')=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);stopProcessTree(child);error?reject(error):resolve(version);};
    const abort=()=>finish(cancelled());
    const timer=setTimeout(()=>finish(Error('版本检测超时，请检查可执行文件后重试。')),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{output=(output+chunk).slice(0,4096);});
    child.stderr.on('data',()=>{});
    child.on('error',()=>finish(Error('无法启动此文件，请检查路径及执行权限。')));
    child.on('close',code=>{
      const match=output.trim().match(/^codex(?:-cli)?\s+(\d+\.\d+\.\d+[^\s]*)$/i);
      finish(code!==0?Error('版本命令执行失败，请检查 CLI 安装。'):!match?Error('此文件未返回 Codex CLI 版本，请选择 codex 可执行文件。'):undefined,match?.[1]);
    });
  });
}

/** Uses the same launcher as chat. Reads local metadata only; never starts a thread. */
export async function detectCli(value:string,options:{signal?:AbortSignal;timeout?:number;update?:(result:CliDetection)=>void}={}):Promise<CliDetection>{
  const result:CliDetection={binary:findBinary(value),checks:initialChecks(),connected:false};
  const update=(id:CliCheck['id'],state:CheckState,detail:string)=>{
    Object.assign(result.checks.find(check=>check.id===id)!,{state,detail});
    if(!options.signal?.aborted)options.update?.(structuredClone(result));
  };
  let stage:CliCheck['id']='path';let client:CodexClient|undefined;
  const abort=()=>client?.dispose();
  try{
    if(options.signal?.aborted)throw cancelled();
    update(stage,'checking','正在查找 Codex CLI…');
    if(!isAbsolute(result.binary))throw Error('未找到 Codex CLI。安装后重新检测，或选择完整路径。');
    try{if(!statSync(result.binary).isFile())throw Error('not a file');}catch{throw Error('此路径不是现有文件，请选择 codex 可执行文件。');}
    try{accessSync(result.binary,process.platform==='win32'?constants.F_OK:constants.X_OK);}catch{throw Error('此文件没有执行权限，请检查 CLI 安装或选择其他文件。');}
    update(stage,'success',result.binary);
    stage='version';update(stage,'checking','正在读取版本…');
    update(stage,'success',await readVersion(result.binary,options.signal,options.timeout));
    if(options.signal?.aborted)throw cancelled();
    stage='connection';update(stage,'checking','正在验证插件能否连接 CLI…');
    if(options.signal?.aborted)throw cancelled();
    client=new CodexClient(options.timeout??5000);options.signal?.addEventListener('abort',abort,{once:true});
    await client.start({...defaults,binary:result.binary,cwd:homedir(),mcpEnabled:false});
    if(options.signal?.aborted)throw cancelled();
    result.connected=true;update(stage,'success','连接成功');
    stage='account';update(stage,'checking','正在读取本机登录状态…');
    const account=await client.request('account/read',{refreshToken:false});
    if(account.account)update(stage,'success',account.account.type==='apiKey'?'已配置 API Key':'已登录 ChatGPT');
    else if(account.requiresOpenaiAuth===false)update(stage,'success','当前模型服务无需 OpenAI 登录');
    else update(stage,'warning','尚未登录。请在终端运行 codex login 后重新检测。');
  }catch(error){
    if(options.signal?.aborted)throw cancelled();
    update(stage,stage==='account'?'warning':'error',stage==='account'?`CLI 已连接，登录状态未确认：${(error as Error).message}`:(error as Error).message);
    for(const check of result.checks)if(check.state==='waiting')check.detail='未检测';
    options.update?.(structuredClone(result));
  }finally{options.signal?.removeEventListener('abort',abort);client?.dispose();}
  return result;
}
