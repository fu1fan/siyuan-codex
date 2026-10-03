import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChatSession,newSession} from '../src/session';
import {defaults} from '../src/codex';
async function main(){
 const dir=mkdtempSync(join(tmpdir(),'siyuan-agent-fixture-'));
 writeFileSync(join(dir,'fixture.txt'),'LOCAL_AGENT_TEST_7341\n');
 const settings={...defaults,cwd:dir};
 let chat=new ChatSession(newSession(dir),settings,()=> '');
 async function turn(text:string){
  const limit=setTimeout(()=>chat.disconnect(),90000);
  let done!:()=>void;const completed=new Promise<void>(r=>done=r);
  chat.onChange=()=>{if(chat.requests.size){for(const[id]of chat.requests)chat.answer(id,{decision:'decline'});}if(!chat.busy)done();};
  await chat.send(text);if(chat.busy)await completed;clearTimeout(limit);
  console.log(JSON.stringify({status:chat.status,messages:chat.session.messages.map(m=>({role:m.role,text:m.text})),thread:chat.session.threadId}));
  if(!chat.session.messages.some(m=>m.role==='assistant'&&m.text.includes('LOCAL_AGENT_TEST_7341')))throw new Error('Expected fixture reply missing');
 }
 try{
  await turn('这是插件集成测试。仅使用本机文件读取工具读取当前目录 fixture.txt，回复文件中的标记。不要写任何文件，不要调用 MCP 或其他工具。');
  const session=chat.session;chat.disconnect();chat=new ChatSession(session,settings,()=> '');
  await turn('这是续聊验证。不要调用任何工具，只重复上一轮文件中的标记。');
  writeFileSync('artifacts/roundtrip.json',JSON.stringify({passed:true,externalDirectory:dir,session},null,2));
 }finally{chat.disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
