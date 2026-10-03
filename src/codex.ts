import {permissionOptions,type PermissionMode} from './permissions';
import {developerInstructions} from './prompts';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {expandLocalPath,findBinary,cliLaunch} from './platform';
import {stopProcessTree} from './process-tree';

export type Rpc = {id?: number|string; method?: string; params?: any; result?: any; error?: {message: string; code: number}};
export type Settings = {binary: string; cwd: string; model: string; fastMode?:boolean; activeTabContext?:boolean; newSessionModelMode?:'last'|'cli'; permissionMode?: PermissionMode|''; modelName?: string; reasoningEffort?: string; sandbox: 'read-only'|'workspace-write'; mcpUrl: string; mcpEnabled: boolean; instructions: string};
export const defaults: Settings = {binary:'',cwd:'',model:'',activeTabContext:false,newSessionModelMode:'last',sandbox:'read-only',mcpUrl:'',mcpEnabled:false,instructions:''};
export const expandPath=expandLocalPath;
export const resolveBinary=findBinary;
export function validateSettings(s: Settings) {
  const cwd=expandPath(s.cwd.trim());
  if(!isAbsolute(cwd)||!existsSync(cwd)||!statSync(cwd).isDirectory()) throw new Error('请选择存在的绝对路径作为工作目录。');
  if(s.mcpEnabled) {
    const u=new URL(s.mcpUrl);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw new Error('MCP 地址必须为 HTTP(S) URL，不能包含用户名或密码。');
    if(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new Error('远程 MCP 请使用 HTTPS；本机可使用 HTTP。');
  }
  return cwd;
}
export function launchConfig(s: Settings) {
  return {...(s.fastMode!==undefined?{service_tier:s.fastMode?'fast':null,'features.fast_mode':true}:{}),...(s.reasoningEffort?{model_reasoning_effort:s.reasoningEffort}:{}),...(s.mcpEnabled? {'mcp_servers.siyuan_local_agent_workspace':{url:s.mcpUrl,bearer_token_env_var:'SIYUAN_LOCAL_AGENT_TOKEN',required:true}}:{})};
}

/** Newline JSON-RPC over a private child process: no shell interpolation or TCP listener. */
export class CodexClient {
  private child?: ChildProcessWithoutNullStreams;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private seq=0;
  private buffer='';
  private stderr='';
  private stopped=false;
  onEvent: (message:Rpc)=>void=()=>{};
  onExit: (error:Error)=>void=()=>{};
  constructor(private timeout=30000) {}
  get alive(){return !!this.child&&!this.stopped;}
  async start(s: Settings,token='',caPath='') {
    if(this.child) throw new Error('Codex 已启动。');
    const cwd=validateSettings(s),launch=cliLaunch(s.binary,['app-server']),env=launch.env;
    // Token stays in process memory/environment, never in argv, logs or synchronized settings.
    if(s.mcpEnabled) {
      Object.assign(env,{SIYUAN_LOCAL_AGENT_TOKEN:token});
      if(caPath&&existsSync(caPath))Object.assign(env,{SSL_CERT_FILE:caPath});
    }
    this.child=spawn(launch.command,launch.args,{cwd,env,stdio:'pipe',shell:false,windowsHide:true,detached:process.platform!=='win32'});
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data',(chunk:string)=>this.consume(chunk));
    this.child.stderr.on('data',(chunk:string)=>{this.stderr=(this.stderr+chunk).slice(-4096);});
    this.child.stdin.on('error',(err)=>this.fail(err));
    this.child.on('error',err=>this.fail(new Error(`无法启动 Codex：${err.message}。请在设置中填写可执行文件完整路径。`)));
    this.child.on('close',(code)=>this.fail(new Error(`Codex 进程已退出（${code}）。请检查 CLI 登录、路径及配置。`)));
    try {
      await this.request('initialize',{clientInfo:{name:'siyuan_codex',title:'SiYuan Codex',version:'0.4.5'},capabilities:{experimentalApi:true}});
      this.notify('initialized',{});
    } catch(err){this.dispose();throw err;}
  }
  private consume(chunk:string) {
    this.buffer+=chunk;
    if(this.buffer.length>16*1024*1024){this.fail(new Error('Codex 协议消息过大。'));this.dispose();return;}
    let newline:number;
    while((newline=this.buffer.indexOf('\n'))>=0) {
      const line=this.buffer.slice(0,newline);this.buffer=this.buffer.slice(newline+1);
      if(!line.trim())continue;
      let m:Rpc;try{m=JSON.parse(line);}catch{this.fail(new Error('Codex 返回无效 JSON 协议消息。'));this.dispose();return;}
      if(m.id!==undefined&&!m.method){const p=this.pending.get(Number(m.id));if(p){clearTimeout(p.timer);this.pending.delete(Number(m.id));m.error?p.reject(Object.assign(new Error(m.error.message),{code:m.error.code})):p.resolve(m.result);}}
      else this.onEvent(m);
    }
  }
  request(method:string,params:unknown):Promise<any> {
    if(!this.alive)return Promise.reject(new Error('Codex 未连接。'));
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} 请求超时，请重新连接。`));this.dispose();},this.timeout);
      this.pending.set(id,{resolve,reject,timer});this.write({id,method,params});
    });
  }
  notify(method:string,params:unknown){this.write({method,params});}
  respond(id:number|string,result:any){this.write({id,result});}
  reject(id:number|string){this.write({id,error:{code:-32601,message:'Unsupported client request'}});}
  private write(m:Rpc){if(this.alive)this.child!.stdin.write(JSON.stringify(m)+'\n');}
  private fail(error:Error){
    if(this.stopped)return; this.stopped=true;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.onExit(error);
  }
  dispose(){
    const child=this.child;this.child=undefined;this.fail(new Error('连接已关闭。'));
    if(child){child.stdin.end();stopProcessTree(child);}
  }
}
export function threadOptions(s:Settings,inheritedInstructions=''){return {cwd:expandPath(s.cwd),ephemeral:false,...(s.fastMode!==undefined?{serviceTier:s.fastMode?'fast':null}:{}),...(s.model?{model:s.model}:{}),...permissionOptions(s),config:launchConfig(s),developerInstructions:developerInstructions(s,inheritedInstructions)};}
