export type ModelSelection={model:string;fastMode?:boolean;modelName?:string;reasoningEffort?:string};
export function newSessionModel(settings:ModelSelection&{newSessionModelMode?:'last'|'cli'}):ModelSelection{
  return settings.newSessionModelMode==='cli'?{model:'',modelName:'',reasoningEffort:'',fastMode:undefined}:{...(settings.fastMode!==undefined?{fastMode:settings.fastMode}:{}),model:settings.model||'',modelName:settings.modelName||'',reasoningEffort:settings.reasoningEffort||''};
}
