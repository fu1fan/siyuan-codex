import type {Message} from './session';
import {toolStatus} from './tool-record';

const siyuanServers=new Set(['siyuan-local','siyuan_local','siyuan_local_agent_workspace']);
const toolNames:Record<string,string>={workspace:'工作空间',document:'文档',block:'内容块',search:'搜索',system:'系统信息'};
// Describe only operations whose contracts are known. Unknown tools keep their original identity.
const operations:Record<string,Record<string,string>>={
 workspace:{info:'查看当前思源工作空间的路径、版本和有效性',list:'列出思源工作空间'},
 document:{get:'读取文档内容',info:'查看文档信息',list:'列出文档',search_docs:'搜索文档',create:'创建文档',delete:'删除文档',rename:'重命名文档',move:'移动文档',duplicate:'复制文档'},
 block:{get:'读取内容块',get_kramdown:'读取内容块的 Markdown',get_children:'读取子块',tree_stat:'查看文档块统计',dom:'读取内容块的 DOM',insert:'插入内容块',append:'追加子块',prepend:'前置子块',update:'替换内容块',delete:'删除内容块',move:'移动内容块',breadcrumb:'查看内容块位置',batch_get:'批量读取内容块',batch_kramdown:'批量读取内容块的 Markdown'},
 search:{fulltext:'全文搜索笔记内容',semantic:'语义搜索笔记内容',asset:'搜索附件内容',getasset:'读取附件的索引内容'},
 system:{version:'查看思源版本',current_time:'查看当前时间',workspace:'查看当前工作空间'},
};
export function mcpApprovalDescription(params:any,messages:Message[]){
 const original=typeof params.message==='string'?params.message:typeof params.description==='string'?params.description:'';
 const match=/^Allow the (.+?) MCP server to run tool ["'](.+?)["']\?$/i.exec(original.trim());
 const server=typeof params.serverName==='string'?params.serverName:match?.[1]||'MCP 服务';
 const name=match?.[2];const siyuan=siyuanServers.has(server),label=name&&(siyuan&&Object.hasOwn(toolNames,name)?toolNames[name]:name);
 const candidates=name?messages.filter(m=>{
  if(m.role!=='tool'||m.tool?.type!=='mcpToolCall'||toolStatus(m)!=='进行中'||(params.turnId&&m.turnId!==params.turnId))return false;
  const identity=m.tool.server&&m.tool.name?[m.tool.server,m.tool.name]:m.tool.title.split(' / ');
  return identity.length===2&&identity[0]===server&&identity[1]===name&&(!params.itemId||m.id===params.itemId);
 }):[];
 let args:Record<string,unknown>|undefined;
 if(candidates.length===1)try{const parsed=JSON.parse(candidates[0].tool!.input||'');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))args=parsed;}catch{}
 const action=typeof args?.action==='string'?args.action:undefined;
 const known=siyuan&&name&&Object.hasOwn(operations,name)?operations[name]:undefined;
 const operation=action?(known&&Object.hasOwn(known,action)?known[action]:`执行操作「${action}」`):name?'请求中未提供具体操作':undefined;
 return {title:name?'允许调用工具？':'MCP 请求确认',summary:name?`智能体准备通过${siyuan?'思源 MCP ':`「${server}」`}调用${label}工具。`:`「${server}」请求你提供信息或确认操作。`,server,tool:name?(label===name?name:`${label}（${name}）`):undefined,operation,args,original,recognized:!!match};
}
