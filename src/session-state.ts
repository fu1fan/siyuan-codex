import type {ChatSession,Session} from './session';

export type SessionState='idle'|'running'|'waiting'|'completed'|'stopped'|'error'|'queued';
export type SessionSummary={id:string;title:string;preview?:boolean;state?:SessionState;unread?:boolean;queueCount?:number;unstarted?:boolean;hasDraft?:boolean};
export const sessionStateLabel:Record<SessionState,string>={idle:'就绪',running:'运行中',waiting:'待确认',completed:'已完成',stopped:'已停止',error:'出错',queued:'排队已暂停'};
export function isUnstarted(session:Session,chat?:ChatSession){return !session.messages.length&&!session.threadId&&!session.queue?.length&&!chat?.busy&&!chat?.requests.size;}
export function sessionSummary(session:Session,chat?:ChatSession):SessionSummary{
  const state:SessionState=chat?.requests.size?'waiting':chat?.busy?'running':session.lastOutcome==='error'?'error':session.queue?.length?'queued':session.lastOutcome||'idle';
  return {id:session.id,title:session.title,preview:!!session.codex&&!session.codex.adopted,state,unread:session.unread,queueCount:session.queue?.length||0,unstarted:isUnstarted(session,chat),hasDraft:!!session.draft||!!session.draftAttachments?.length};
}
