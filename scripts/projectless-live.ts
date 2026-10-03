// Creates one clearly named compatibility fixture using Codex's own persistence.
// --infer submits a minimal real turn. No config, SQLite or rollout files are edited.
import {writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {CodexClient,defaults} from '../src/codex';
import {ChatSession,newSession} from '../src/session';
import {codexProjectlessRoot,sessionStandaloneDirectory,prepareStandalone} from '../src/workspaces';

async function main(){
  const probe=new CodexClient();let chat:ChatSession|undefined;
  try{
    await probe.start({...defaults,cwd:homedir(),mcpEnabled:false});
    const config=(await probe.request('config/read',{cwd:homedir(),includeLayers:false})).config;
    const root=codexProjectlessRoot(config),session=newSession('');
    session.workspaceMode='auto';session.cwd=sessionStandaloneDirectory(session,root);prepareStandalone(session);
    session.title='思源插件验收 · Codex 无项目会话互通';
    chat=new ChatSession(session,{...defaults,cwd:session.cwd,mcpEnabled:false},()=> '');
    await chat.connect();
    const client=chat.client!;
    await client.request('thread/name/set',{threadId:session.threadId,name:session.title});
    console.log(JSON.stringify({created:true,threadId:session.threadId,cwd:session.cwd}));
    const infer=process.argv.includes('--infer');
    if(infer){
      const accepted=await chat.send('这是思源插件与 Codex 桌面版的会话兼容性验收。不要调用工具或修改文件，只回复：目录兼容验证通过。');
      if(!accepted)throw Error(chat.status);
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Compatibility turn timed out')),45000);
        const check=()=>{if(!chat!.busy){clearTimeout(timer);chat!.session.lastOutcome==='completed'?resolve():reject(Error(chat!.status));}};
        chat!.onChange=check;check();
      });
    }
    const listed=await client.request('thread/list',{cwd:session.cwd,sortKey:'updated_at',limit:100,useStateDbOnly:true});
    // Persistence is checked after the originating process has disconnected.
    if(infer)chat.disconnect();
    const read=await probe.request('thread/read',{threadId:session.threadId,includeTurns:false});
    const thread=read.thread;
    const evidence={threadId:session.threadId,title:session.title,cwd:session.cwd,root,source:thread.source,cliVersion:thread.cliVersion,ephemeral:thread.ephemeral,
      defaultListing:listed.data.some((t:any)=>t.id===session.threadId),independentRead:thread.cwd===session.cwd,
      inference:infer,outcome:session.lastOutcome,answer:session.messages.find(m=>m.role==='assistant'&&m.phase!=='commentary')?.text,desktopListVerified:false,nativeDesktopVerified:false};
    writeFileSync('artifacts/projectless-live.json',JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence));
    if(evidence.ephemeral||!evidence.independentRead||(infer&&!evidence.defaultListing))throw Error('Codex thread persistence/listing failed');
  }finally{chat?.disconnect();probe.dispose();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
