import {jsonPromptData} from './prompts';
import type {CodexClient} from './codex';
export const workspaceMcpServer='siyuan_local_agent_workspace';
export type WorkspaceMcpState={status:'configured'|'connected'|'unavailable'|'disabled'|'unknown';checkedAt?:string;tools?:string[]};
export async function inspectWorkspaceMcp(client:Pick<CodexClient,'request'>,threadId:string):Promise<WorkspaceMcpState>{
  const checkedAt=new Date().toISOString();let cursor:string|undefined;
  try{for(let page=0;page<10;page++){
    const result=await client.request('mcpServerStatus/list',{threadId,...(cursor?{cursor}:{})});
    const server=result.data?.find((s:any)=>s.name===workspaceMcpServer);
    if(server){
      const tools=Object.entries(server.tools||{}).map(([name,t]:[string,any])=>typeof t.name==='string'?t.name:name).filter((v:string)=>v.length<160).sort();
      return {status:tools.length&&!server.toolsError?'connected':'unavailable',checkedAt,tools:tools.slice(0,60)};
    }
    cursor=result.nextCursor;if(!cursor)break;
  }}catch{return {status:'unknown',checkedAt};}
  return {status:'unavailable',checkedAt};
}
export function siyuanWorkspacePrompt(workspace:string|undefined,mcpUrl:string,state:WorkspaceMcpState){
  if(!workspace)return '';
  let endpoint:string|undefined;try{const u=new URL(mcpUrl);endpoint=u.origin+u.pathname;}catch{}
  return '\n\n<siyuan_workspace>\n思源工作区与 MCP 状态（运行时元数据，不含笔记正文；工作区路径与 Codex 工作目录不同）：'+jsonPromptData({workspacePath:workspace,mcpServer:workspaceMcpServer,endpoint,...state})+'\n</siyuan_workspace>';
}
