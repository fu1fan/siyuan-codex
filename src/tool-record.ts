import type {Message} from './session';
export type ToolRecord={type:string;title:string;server?:string;name?:string;input?:string;output?:string;error?:string;cwd?:string;exitCode?:number;durationMs?:number};
export function printable(value:unknown):string {
 if(value===undefined||value===null)return '';
 return (typeof value==='string'?value:JSON.stringify(value,null,2)).slice(0,200000);
}
export function toolRecord(item:any,previous?:ToolRecord):ToolRecord|undefined {
 const value=item.aggregatedOutput??item.result??item.contentItems??item.output;
 const base={type:item.type,title:'工具调用',output:value===undefined||value===null?previous?.output:printable(value),error:printable(item.error)||undefined,durationMs:item.durationMs??undefined};
 switch(item.type){
  case 'commandExecution':return {...base,title:'运行命令',input:item.command,cwd:item.cwd,exitCode:item.exitCode??undefined};
  case 'fileChange':return {...base,title:`修改 ${item.changes?.length||0} 个文件`,input:printable(item.changes),output:previous?.output};
  case 'mcpToolCall':return {...base,title:`${item.server} / ${item.tool}`,server:item.server,name:item.tool,input:printable(item.arguments)};
  case 'dynamicToolCall':return {...base,title:[item.namespace,item.tool].filter(Boolean).join(' / '),input:printable(item.arguments),error:item.success===false?(base.error||'工具执行失败'):base.error};
  case 'webSearch':return {...base,title:item.action?.type==='openPage'?'打开网页':item.action?.type==='findInPage'?'搜索网页内容':'搜索网页',input:printable(item.action||item.query),output:printable(item.results)||undefined};
  case 'imageView':return {...base,title:'查看图像',input:item.path};
  case 'collabAgentToolCall':return {...base,title:`协作 · ${item.tool}`,input:printable({prompt:item.prompt,threads:item.receiverThreadIds}),output:printable(item.agentsStates)};
  case 'functionCallOutput':return {...base,title:item.name};
  case 'sleep':return {...base,title:'等待',input:`${Math.round(item.durationMs/1000)} 秒`};
  default:return undefined;
 }
}
export function toolStatus(message:Message){
 if(message.status==='failed'||message.status==='declined'||message.tool?.error||(message.tool?.exitCode!==undefined&&message.tool.exitCode!==0))return '失败';
 if(message.status==='interrupted')return '已停止';
 if(message.status==='completed')return '已完成';
 return '进行中';
}
