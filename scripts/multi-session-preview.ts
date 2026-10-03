// Shared ChatView, simulated jobs: visual/interaction checks do not imply model inference.
import {ChatView} from '../src/ui';
import {sessionSummary,isUnstarted} from '../src/session-state';
import {toolRecord} from '../src/tool-record';
const jobs:any[]=[];let active:any,view:ChatView,sequence=0;
const create=(title:string,state='idle')=>{
 const duration=state==='running'?1584000:1583000,startedAt=Date.now()-duration;
 const job:any={busy:state==='running',workStartedAt:startedAt,status:state==='running'?'正在思考…':state==='idle'?'尚未连接':'已完成',requests:new Map(),resolvedModel:'gpt-6.1-sol',resolvedEffort:'medium',settings:{cwd:'/tmp/会话独立目录',model:'gpt-6.1-sol',reasoningEffort:'medium',sandbox:'read-only'},session:{id:'session-'+sequence++,title,messages:state==='idle'?[]:[{id:'u',role:'user',text:'整理这份资料的结论。',startedAt,...(state==='completed'?{elapsedMs:duration}:{})},...(state==='running'?[]:[{id:'a',role:'assistant',text:'已整理完成。可以继续提问，或切换到另一个运行中的会话。',phase:'final_answer'}])],updated:Date.now(),lastOutcome:state==='completed'?'completed':undefined,unread:state==='completed'},pauseQueue(){},answer(id:string){job.requests.delete(id);view.update();}};
 jobs.push(job);return job;
};
const a=create('文献综述 · 整理研究结论','running'),b=create('尝试调用思源 MCP','running'),c=create('实验计划与验证步骤','completed');
const external=[{threadId:'desktop-history-preview',title:'桌面研究 · 专家并行布局',cwd:'/Users/example/Documents/PROJECTS/Research',updated:Date.now(),archived:false},{threadId:'cli-history-preview',title:'CLI 历史 · 思源笔记整理',cwd:'/Users/example/Documents/Codex/2026-10-02/notes',updated:Date.now(),archived:false},{threadId:'archive-history-preview',title:'旧实验结果与改进计划',cwd:'/Users/example/Documents/PROJECTS/Experiments',updated:Date.now(),archived:true}];
const error=create('请求失败（模拟）');error.session.messages=[{id:'error',role:'error',text:'请求失败（模拟），可重新发送。'}];error.session.lastOutcome='error';error.session.unread=true;error.status='发生错误';
b.workStartedAt=Date.now()-32000;b.session.messages=[{id:'u',role:'user',text:'尝试调用一下思源 MCP 的其中一个工具，然后告诉我，MCP 的工具说明是否截断',startedAt:b.workStartedAt},{id:'progress',role:'assistant',phase:'commentary',turnId:'preview-turn',text:'我先查找可用的思源 MCP 工具，尝试一次只读调用，再检查工具说明是否有截断迹象。'},{id:'mcp-workspace',role:'tool',turnId:'preview-turn',status:'inProgress',text:'',tool:toolRecord({type:'mcpToolCall',server:'siyuan-local',tool:'workspace',arguments:{action:'info'}})}];
b.requests.set('7',{id:7,method:'mcpServer/elicitation/request',params:{serverName:'siyuan-local',turnId:'preview-turn',mode:'form',message:'Allow the siyuan-local MCP server to run tool "workspace"?',requestedSchema:{type:'object',properties:{}}}});b.session.unread=false;active=b;
view=new ChatView(document.getElementById('app')!,()=>active,{
 list:()=>jobs.map(j=>sessionSummary(j.session,j)),select:id=>{active=jobs.find(j=>j.session.id===id);active.session.unread=false;view.update();},
 newChat:()=>{active=(isUnstarted(active.session,active)&&active)||jobs.find(j=>isUnstarted(j.session,j))||create('新对话');view.update();},
 send:async text=>{active.workStartedAt=Date.now();if(active.session.title==='新对话')active.session.title=text.slice(0,32);if(active.session.codex)active.session.codex.adopted=true;active.session.messages.push({id:crypto.randomUUID(),role:'user',text,startedAt:active.workStartedAt});active.busy=true;active.status='正在思考…';active.session.lastOutcome=undefined;view.update();return true;},
 searchCodex:async query=>({data:external.filter(entry=>entry.title.includes(query))}),
 openCodex:async(entry,isCurrent)=>{if(isCurrent&&!isCurrent())return;active=jobs.find(job=>job.session.threadId===entry.threadId)||create(entry.title,'completed');active.session.threadId=entry.threadId;active.session.cwd=entry.cwd;active.settings.cwd=entry.cwd;active.session.codex??={adopted:false};view.update();},
 stop:()=>{const user=active.session.messages.findLast((m:any)=>m.role==='user');if(user)user.elapsedMs=Date.now()-user.startedAt;active.busy=false;active.status='已停止';active.requests.clear();active.session.lastOutcome='stopped';view.update();},
 settings:()=>{},attach:()=>{},clear:()=>{},context:()=>'',
 rename:(id,title)=>{jobs.find(j=>j.session.id===id).session.title=title;view.update();},delete:id=>{const index=jobs.findIndex(j=>j.session.id===id),job=jobs[index];if(!job)return;job.busy=false;job.requests.clear();jobs.splice(index,1);if(active.session.id===id)active=jobs[0]||create('新对话');view.update();}
});
const finish=(job:any)=>{const user=job.session.messages.findLast((m:any)=>m.role==='user');if(user)user.elapsedMs=Date.now()-user.startedAt;job.busy=false;job.requests.clear();job.session.lastOutcome='completed';job.session.unread=job!==active;job.status='已完成';job.session.messages.push({id:crypto.randomUUID(),role:'assistant',text:'问答已完成，结果保留在本会话。',phase:'final_answer'});view.update();};
document.getElementById('finish')!.onclick=()=>finish(jobs.find(j=>j!==active&&j.busy)||active);
document.getElementById('finish-current')!.onclick=()=>finish(active);
const fail=document.createElement('button');fail.textContent='模拟当前会话出错';fail.onclick=()=>{active.busy=false;active.requests.clear();active.session.lastOutcome='error';active.session.unread=false;active.status='请求失败（模拟）';view.update();};document.querySelector('aside')!.append(fail);
document.getElementById('permission')!.onclick=()=>{active=b;view.update();};
document.getElementById('dark')!.onclick=()=>document.body.classList.toggle('dark');
document.getElementById('width')!.onchange=event=>{document.getElementById('app')!.style.width=(event.target as HTMLSelectElement).value+'px';};
(window as any).preview={jobs,view,get active(){return active;}};
