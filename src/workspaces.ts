import {mkdirSync,existsSync,statSync,lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute,join,relative} from 'node:path';
import {expandPath} from './codex';
import {api,validID} from './context';
import type {Session} from './session';

export type WorkspaceBinding={docID:string;title:string;cwd:string};
export type WorkspaceDocument={id:string;title:string;ancestors:string[]};
/** Desktop stores this preference in [desktop], independently of project cwd. */
export function codexProjectlessRoot(config?:unknown,home=homedir()){
  const value=(config as {desktop?:{projectlessWorkspaceRoot?:unknown}})?.desktop?.projectlessWorkspaceRoot;
  if(value===undefined||value===null)return join(home,'Documents','Codex');
  if(typeof value!=='string'||!isAbsolute(value)||!value.trim())throw Error('Codex 的无项目任务文件夹必须是本机绝对路径。');
  return value;
}
export function standaloneDirectory(id:string,root=codexProjectlessRoot(),date=new Date()){
  if(!/^[a-zA-Z0-9-]+$/.test(id))throw Error('无效的会话 ID');
  if(!isAbsolute(root)||!Number.isFinite(date.getTime()))throw Error('无效的无项目任务目录');
  const day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  return join(root,day,`siyuan-${id}`);
}
export function sessionStandaloneDirectory(session:Session,root=codexProjectlessRoot()){
  // Remember allocation time: returning from a document binding or restarting
  // after midnight must reuse the same folder. Started chats never migrate.
  if(!session.standalone||(!workspaceLocked(session)&&session.standalone.root!==root))session.standalone={root,cwd:standaloneDirectory(session.id,root)};
  return session.standalone.cwd;
}
export function isStandaloneDirectory(cwd:string,root=codexProjectlessRoot()){
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}[\\/]siyuan-[a-zA-Z0-9-]+$/.test(relative(root,cwd))||/[\\/]\.siyuan-local-agent[\\/]workspaces[\\/][a-zA-Z0-9-]+[\\/]?$/.test(cwd);
}
export function prepareStandalone(session:Session){
  const standalone=session.standalone;
  if(standalone&&session.cwd===standalone.cwd){
    const suffix=relative(standalone.root,standalone.cwd);
    if(!isAbsolute(standalone.root)||!/^\d{4}-\d{2}-\d{2}[\\/]siyuan-[a-zA-Z0-9-]+$/.test(suffix))throw Error('无效的无项目会话目录');
    // Match Desktop's real-directory requirement; never follow a replaced link.
    for(const path of [standalone.root,join(standalone.root,suffix.split(/[\\/]/)[0]),standalone.cwd]){
      mkdirSync(path,{recursive:true});
      const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Codex 无项目任务目录必须是真实文件夹，不能是符号链接。');
    }
  }else if(/^[a-zA-Z0-9-]+$/.test(session.id)&&session.cwd===join(homedir(),'.siyuan-local-agent','workspaces',session.id))mkdirSync(session.cwd,{recursive:true});
}
export function validateDirectory(value:string){
  const cwd=expandPath(value.trim());
  if(!isAbsolute(cwd)||!existsSync(cwd)||!statSync(cwd).isDirectory())throw Error('请选择存在的本机绝对路径。');
  return cwd;
}
export function workspaceLocked(session:Session,busy=false){
  return busy||!!session.workspaceLocked||!!session.threadId||!!session.queue?.length||session.messages.some(m=>m.role==='user'||m.role==='assistant');
}
export function followsDocument(session:Session,busy=false){return session.workspaceMode==='auto'&&!workspaceLocked(session,busy);}
export function readBindings(value:unknown):WorkspaceBinding[]{
  const entries=(value as {bindings?:unknown})?.bindings;
  if(!Array.isArray(entries))return [];
  return [...new Map(entries.filter(b=>validID(b?.docID)&&typeof b.cwd==='string'&&typeof b.title==='string').map(b=>[b.docID,{docID:b.docID,title:b.title,cwd:b.cwd}])).values()];
}
export function matchingBinding(doc:WorkspaceDocument,bindings:WorkspaceBinding[]){
  for(const id of [...doc.ancestors].reverse()){const binding=bindings.find(b=>b.docID===id);if(binding)return binding;}
}
export async function readWorkspaceDocument(id:string):Promise<WorkspaceDocument>{
  if(!validID(id))throw Error('请先打开思源文档。');
  const info=await api('/api/block/getBlockInfo',{id});
  if(info?.rootID!==id||typeof info.path!=='string')throw Error('无法读取当前文档的位置。');
  const ancestors=info.path.split('/').map((part:string)=>part.replace(/\.sy$/,'')).filter(validID);
  if(ancestors.at(-1)!==id)throw Error('文档路径与当前文档不一致。');
  return {id,title:info.rootTitle||id,ancestors};
}
