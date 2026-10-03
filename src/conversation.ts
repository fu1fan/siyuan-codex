import type {Message} from './session';
export function conversationRows(messages:Message[],busy=false){
 const rows:({kind:'message';message:Message}|{kind:'work';id:string;messages:Message[];startedAt?:number;elapsedMs?:number;running:boolean})[]=[];
 if(busy&&!messages.length)rows.push({kind:'work',id:'work:pending',messages:[],running:true});
 const groups:Message[][]=[];for(const m of messages){if((m.role==='user'&&m.status!=='steered')||!groups.length)groups.push([]);groups.at(-1)!.push(m);}
 groups.forEach((group,index)=>{
  const user=group[0]?.role==='user'?group[0]:undefined;if(user)rows.push({kind:'message',message:user});
  const rest=user?group.slice(1):group;const running=busy&&index===groups.length-1;
  const final=[...rest].reverse().find(m=>m.role==='assistant'&&m.phase==='final_answer')||(!running?[...rest].reverse().find(m=>m.role==='assistant'&&m.phase!=='commentary'):undefined);
  const work=rest.filter(m=>m!==final&&m.role!=='error');
  if(work.length||running||user?.elapsedMs!==undefined)rows.push({kind:'work',id:'work:'+(user?.id||group[0].id),messages:work,startedAt:user?.startedAt,elapsedMs:user?.elapsedMs,running});
  if(final)rows.push({kind:'message',message:final});for(const m of rest.filter(m=>m.role==='error'))rows.push({kind:'message',message:m});
 });return rows;
}
export function workDuration(ms?:number,running=false){if(ms===undefined)return '工作过程';const sec=Math.max(0,Math.floor(ms/1000));return `${running?'已处理':'用时'} ${sec>=60?Math.floor(sec/60)+'分钟 ':''}${sec%60}秒`;}
