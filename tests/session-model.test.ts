import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newSessionModel} from '../src/session-model';
import {newSession,ChatSession} from '../src/session';
import {defaults,threadOptions} from '../src/codex';
test('new-session policy inherits last selection or omits model and effort for CLI defaults',()=>{
 const previous={...defaults,model:'last-model',modelName:'Last Model',reasoningEffort:'high'};
 const inherit=newSession('/tmp',newSessionModel(previous));
 assert.deepEqual(inherit.modelSelection,{model:'last-model',modelName:'Last Model',reasoningEffort:'high'});
 const cli=newSession('/tmp',newSessionModel({...previous,newSessionModelMode:'cli'}));
 const options=threadOptions({...previous,...cli.modelSelection});assert.equal('model' in options,false);assert.equal('model_reasoning_effort' in options.config,false);
 assert.equal(newSessionModel(defaults).model,'');
 previous.model='later-model';assert.equal(inherit.modelSelection?.model,'last-model');
 const restored=JSON.parse(JSON.stringify(inherit));assert.equal(restored.modelSelection.reasoningEffort,'high');
 const resumed=new ChatSession(restored,{...previous,...restored.modelSelection},()=> '');assert.equal(resumed.settings.model,'last-model');
});
