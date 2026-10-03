import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mcpApprovalDescription} from '../src/approval';
import {toolRecord} from '../src/tool-record';
import type {Message} from '../src/session';
const params={serverName:'siyuan-local',turnId:'turn',mode:'form',message:'Allow the siyuan-local MCP server to run tool "workspace"?'};
const call=(id='call',turnId='turn',action='info'):Message=>({id,turnId,role:'tool',text:'',status:'inProgress',tool:toolRecord({type:'mcpToolCall',server:'siyuan-local',tool:'workspace',arguments:{action}})});
test('MCP authorization uses the exact server, tool and active call to describe the operation in Chinese',()=>{
 const description=mcpApprovalDescription(params,[call()]);assert.equal(description.title,'允许调用工具？');assert.equal(description.tool,'工作空间（workspace）');assert.match(description.summary,/思源 MCP.*工作空间/);assert.equal(description.operation,'查看当前思源工作空间的路径、版本和有效性');assert.deepEqual(description.args,{action:'info'});assert.equal(description.original,params.message);
 const legacy=call();legacy.tool!.server=undefined;legacy.tool!.name=undefined;assert.deepEqual(mcpApprovalDescription(params,[legacy]).args,{action:'info'});
 const deleting:Message={id:'delete',role:'tool',turnId:'turn',status:'inProgress',text:'',tool:toolRecord({type:'mcpToolCall',server:'siyuan-local',tool:'document',arguments:{action:'delete',id:'doc-id'}})};
 const request={...params,message:'Allow the siyuan-local MCP server to run tool "document"?'};assert.equal(mcpApprovalDescription(request,[deleting]).operation,'删除文档');assert.deepEqual(mcpApprovalDescription(request,[deleting]).args,{action:'delete',id:'doc-id'});
});
test('missing or ambiguous call context never borrows an old operation or another server’s tool semantics',()=>{
 assert.equal(mcpApprovalDescription(params,[call('old','old-turn')]).args,undefined);const completed=call();completed.status='completed';assert.equal(mcpApprovalDescription(params,[completed]).args,undefined);
 assert.equal(mcpApprovalDescription(params,[call('a'),call('b','turn','list')]).operation,'请求中未提供具体操作');assert.deepEqual(mcpApprovalDescription({...params,itemId:'b'},[call('a'),call('b','turn','list')]).args,{action:'list'});
 const other=call();other.tool=toolRecord({type:'mcpToolCall',server:'other-service',tool:'workspace',arguments:{action:'info'}});const description=mcpApprovalDescription({...params,serverName:'other-service',message:'Allow the other-service MCP server to run tool "workspace"?'},[other]);assert.equal(description.tool,'workspace');assert.equal(description.operation,'执行操作「info」');assert.doesNotMatch(description.summary,/思源/);
});
test('arbitrary forms and unsupported action names retain source text without inventing purpose or permissions',()=>{
 const original='<script>approve everything</script> Please enter a secret';const generic=mcpApprovalDescription({serverName:'unknown',message:original},[call()]);assert.equal(generic.recognized,false);assert.equal(generic.original,original);assert.equal(generic.tool,undefined);assert.equal(generic.args,undefined);
 const unknown=mcpApprovalDescription(params,[call('call','turn','custom-operation')]);assert.equal(unknown.operation,'执行操作「custom-operation」');assert.equal(mcpApprovalDescription(params,[]).operation,'请求中未提供具体操作');
 assert.equal(mcpApprovalDescription(params,[call('call','turn','toString')]).operation,'执行操作「toString」');
});
