import {CodexClient,defaults,threadOptions} from '../src/codex';
async function main(){
const client=new CodexClient(30000);
const settings={...defaults,cwd:process.cwd()};
client.onEvent=m=>{if(m.id!==undefined)client.reject(m.id);};
try{
 await client.start(settings);
 const config=await client.request('config/read',{cwd:settings.cwd,includeLayers:false});
 const inherited=typeof config.config?.developer_instructions==='string'?config.config.developer_instructions:'';
 const options=threadOptions(settings,inherited);
 if(inherited.trim()&&!options.developerInstructions.startsWith(inherited.trim()))throw Error('CLI developer instructions were not preserved');
 const response=await client.request('thread/start',{...options,ephemeral:true});
 console.log(JSON.stringify({handshake:true,instructionsRead:true,inheritedInstructionChars:inherited.length,thread:!!response.thread.id,model:response.model,sandbox:response.sandbox,noInference:true}));
 const models=await client.request('model/list',{});
 console.log(JSON.stringify({models:models.data?.length}));
}finally{client.dispose();}

}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
