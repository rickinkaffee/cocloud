import assert from 'node:assert/strict';
import {responseRequest,completionFromResponse} from '../model-router.mjs';
const request=responseRequest({messages:[{role:'system',content:'Extract facts'},{role:'user',content:'Historical text'}],response_format:{type:'json_schema',json_schema:{name:'facts',strict:true,schema:{type:'object',properties:{},additionalProperties:false}}},max_tokens:1200},'chosen-model');
assert.equal(request.model,'chosen-model');assert.equal(request.text.format.type,'json_schema');assert.equal(request.max_output_tokens,1200);assert.equal(request.input[1].content,'Historical text');assert.equal(request.store,false);
const result=completionFromResponse({id:'r',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:'{"facts":[]}'}]}],usage:{input_tokens:30,output_tokens:7}},'chosen-model');
assert.equal(result.choices[0].message.content,'{"facts":[]}');assert.equal(result.usage.prompt_tokens,30);assert.equal(result.model,'chosen-model');
assert.throws(()=>completionFromResponse({status:'incomplete'},'x'));assert.throws(()=>completionFromResponse({output:[]},'x'));
console.log('Model routing regression passed: selected model, structured output, usage, incomplete/empty output rejection');
