import {test} from 'node:test';import assert from 'node:assert/strict';
import {conversationRows,workDuration} from '../src/conversation';
import {ChatSession,newSession,type Message} from '../src/session';import {defaults} from '../src/codex';
const messages:Message[]=[{id:'u',role:'user',text:'question',turnId:'t1',elapsedMs:422000},{id:'p',role:'assistant',text:'progress',phase:'commentary',turnId:'t1'},{id:'tool',role:'tool',text:'command',turnId:'t1'},{id:'a',role:'assistant',text:'answer',phase:'final_answer',turnId:'t1'},{id:'u2',role:'user',text:'later',turnId:'t2'}];
test('work is grouped separately from final answers and unknown streaming messages stay in work',()=>{
 const rows=conversationRows(messages);assert.equal(rows[1].kind,'work');if(rows[1].kind==='work')assert.deepEqual(rows[1].messages.map(m=>m.id),['p','tool']);assert.equal(rows[2].kind,'message');
 assert.equal(workDuration(422000),'用时 7分钟 2秒');assert.equal(workDuration(1584000,true),'已处理 26分钟 24秒');assert.equal(workDuration(999,true),'已处理 0秒');
 const legacy:Message[]=[{id:'u',role:'user',text:'x'},{id:'a',role:'assistant',text:'answer'}];assert.equal(conversationRows(legacy,true)[1].kind,'work');assert.equal(conversationRows(legacy,false)[1].kind,'message');
});
test('branch boundaries fork an independent CLI thread, omit later turns, and preserve source',async()=>{
 const session=newSession('/tmp');session.threadId='source';session.messages=structuredClone(messages);let params:any;
 const client:any={alive:false,start:async()=>{client.alive=true;},dispose:()=>{client.alive=false;},request:async(method:string,p:any)=>{if(method==='thread/fork'){params=p;return {thread:{id:'branch'}};}return {thread:{id:'source'},model:'m'};}};
 const chat=new ChatSession(session,{...defaults,cwd:'/tmp'},()=>'', '',()=>client);
 const assistant=await chat.forkAt('a');assert.equal(params.lastTurnId,'t1');assert.equal(assistant.session.threadId,'branch');assert.equal(assistant.session.messages.length,4);assert.equal(session.messages.length,5);assert.equal(session.threadId,'source');
 const user=await chat.forkAt('u2');assert.equal(params.beforeTurnId,'t2');assert.equal('lastTurnId' in params,false);assert.equal(user.draft?.text,'later');assert.equal(user.session.messages.length,4);chat.disconnect();
});

test('steered messages remain in the active work group and a pending turn is visible',()=>{
 const group:Message[]=[{id:'u',role:'user',text:'q',turnId:'t'},{id:'p',role:'assistant',text:'checking',phase:'commentary',turnId:'t'},{id:'s',role:'user',text:'clarification',status:'steered',turnId:'t'},{id:'a',role:'assistant',text:'done',phase:'final_answer',turnId:'t'}];
 const rows=conversationRows(group,true);assert.equal(rows.length,3);assert.equal(rows[1].kind,'work');if(rows[1].kind==='work'){assert.equal(rows[1].running,true);assert.deepEqual(rows[1].messages.map(m=>m.id),['p','s']);}
 assert.equal(conversationRows(group.slice(0,1),true)[1].kind,'work');
 assert.equal(conversationRows([],true)[0].kind,'work');
 const completed=conversationRows([{id:'u',role:'user',text:'q',startedAt:10000,elapsedMs:1583000},{id:'a',role:'assistant',text:'done',phase:'final_answer'}]);
 assert.equal(completed[1].kind,'work');if(completed[1].kind==='work'){assert.equal(completed[1].startedAt,10000);assert.equal(completed[1].elapsedMs,1583000);assert.equal(completed[1].running,false);}assert.equal(completed[2].kind,'message');
});
