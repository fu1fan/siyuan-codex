import type {CodexClient} from './codex';
import {newSession,type Session,type Message} from './session';
import {toolRecord} from './tool-record';

export type CodexHistoryEntry={threadId:string;title:string;cwd:string;updated:number;archived:boolean};
export type CodexHistoryPage={data:CodexHistoryEntry[];nextCursor?:string};
type Reader=Pick<CodexClient,'request'>;
const sourceKinds=['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'];
export function pluginHistory(session:Session){return !session.codex||session.codex.adopted;}
export function threadTitle(thread:any){return thread.name?.trim()||thread.preview?.trim().split('\n')[0].slice(0,80)||'Codex 对话';}
function unsupported(error:unknown){const e=error as Error&{code?:number};return e.code===-32601||/method not found|unknown method|unsupported|does not support.*pagination/i.test(e.message);}

// Active threads first, archived threads afterwards. Explicit filters include
// app-server, exec and subagent histories as well as CLI chats.
export async function searchCodexHistory(client:Reader,query:string,cursor?:string):Promise<CodexHistoryPage>{
  const page=cursor?JSON.parse(cursor):{archived:false,cursor:undefined};
  const result=await client.request('thread/list',{limit:30,sortKey:'updated_at',sortDirection:'desc',modelProviders:[],sourceKinds,archived:page.archived,...(page.cursor?{cursor:page.cursor}:{}),...(query.trim()?{searchTerm:query.trim()}:{}),useStateDbOnly:true});
  if(!Array.isArray(result.data))throw Error('Codex 返回了无效的会话列表。');
  const data=result.data.filter((t:any)=>t.id&&!t.ephemeral).map((t:any)=>({threadId:t.id,title:threadTitle(t),cwd:t.cwd||'',updated:(t.updatedAt||t.createdAt||0)*1000,archived:page.archived}));
  const nextCursor=result.nextCursor?JSON.stringify({archived:page.archived,cursor:result.nextCursor}):!page.archived?JSON.stringify({archived:true}):undefined;
  if(!data.length&&!page.archived&&!result.nextCursor)return searchCodexHistory(client,query,nextCursor);
  return {data,nextCursor};
}

export function historyMessages(turns:any[]):Message[]{
  const messages:Message[]=[];
  for(const turn of turns)for(const item of turn.items||[]){
    const status=item.status||(turn.status==='inProgress'?'inProgress':turn.status==='interrupted'?'interrupted':'completed');
    const common={id:item.clientId||item.id,turnId:turn.id,status};
    if(item.type==='userMessage'){
      const text=(item.content||[]).map((c:any)=>c.type==='text'?c.text:c.type==='localImage'?`［图片：${c.path}］`:c.type==='image'?'［图片］':c.type==='skill'||c.type==='mention'?`［${c.name}：${c.path}］`:c.type==='audio'||c.type==='localAudio'?'［音频］':'').filter(Boolean).join('\n');
      messages.push({...common,role:'user',text,displayText:text,...(turn.startedAt?{startedAt:turn.startedAt*1000}:{}),...(turn.durationMs!=null?{elapsedMs:turn.durationMs}:{})});
    }else if(item.type==='agentMessage'||item.type==='plan')messages.push({...common,role:'assistant',text:item.text||'',phase:item.phase||(item.type==='plan'?'commentary':undefined)});
    else {const tool=toolRecord(item);if(tool)messages.push({...common,role:'tool',text:[tool.input,tool.output,tool.error].filter(Boolean).join('\n'),tool});}
  }
  return messages;
}

export async function readCodexThread(client:Reader,threadId:string){
  const result=await client.request('thread/read',{threadId,includeTurns:false});
  const thread=result.thread;if(!thread||thread.id!==threadId)throw Error('Codex 未返回所选会话。');
  let turns:any[]=[];let cursor:string|undefined;const seen=new Set<string>();
  try{
    do{
      const page=await client.request('thread/turns/list',{threadId,limit:50,sortDirection:'asc',itemsView:'full',...(cursor?{cursor}:{})});
      if(!Array.isArray(page.data))throw Error('Codex 返回了无效的历史消息。');
      turns.push(...page.data);cursor=page.nextCursor||undefined;
      if(cursor&&seen.has(cursor))throw Error('Codex 历史分页重复，请重新打开会话。');if(cursor)seen.add(cursor);
    }while(cursor);
  }catch(error){
    if(!unsupported(error))throw error;
    const legacy=await client.request('thread/read',{threadId,includeTurns:true});
    if(!Array.isArray(legacy.thread?.turns))throw Error('此 Codex 版本无法读取历史消息。');turns=legacy.thread.turns;
  }
  return {thread,messages:historyMessages(turns)};
}

export function importedSession(thread:any,messages:Message[]):Session{
  if(!thread.cwd)throw Error('原会话没有工作目录，无法继续。');
  const session=newSession(thread.cwd,{model:thread.model||'',reasoningEffort:thread.reasoningEffort||'',fastMode:undefined});
  return {...session,title:threadTitle(thread),threadId:thread.id,messages,workspaceMode:'manual',workspaceLocked:true,updated:(thread.updatedAt||thread.createdAt||0)*1000,modelProvider:thread.modelProvider||undefined,codex:{adopted:false}};
}

// Preserve plugin display text and attachments on a remote history refresh.
export function mergeHistory(remote:Message[],local:Message[]){
  const byId=new Map(local.map(message=>[message.id,message]));
  const localUsers=new Map<string,Message[]>(),remoteUsers=new Map<string,number>();
  for(const message of local)if(message.role==='user'&&message.turnId)localUsers.set(message.turnId,[...(localUsers.get(message.turnId)||[]),message]);
  for(const message of remote)if(message.role==='user'&&message.turnId)remoteUsers.set(message.turnId,(remoteUsers.get(message.turnId)||0)+1);
  return remote.map(message=>{
    const candidates=message.turnId?localUsers.get(message.turnId):undefined;
    const saved=byId.get(message.id)||(message.role==='user'&&candidates?.length===1&&remoteUsers.get(message.turnId!)===1?candidates[0]:undefined);
    return saved?{...message,...saved,text:message.role==='user'?saved.text:message.text,status:message.status}:message;
  });
}
