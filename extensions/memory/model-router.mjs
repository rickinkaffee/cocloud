import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const python=process.env.MEMORY_PYTHON||'python3';
const script=new URL('./model_config.py',import.meta.url).pathname;
let cached=null,pending=null;
export async function modelCatalogue(force=false){
 if(!force&&cached&&Date.now()-cached.saved<60000)return cached.value;
 if(pending)return pending;
 pending=exec(python,[script],{timeout:30000,maxBuffer:1024*1024}).then(r=>{const value=JSON.parse(r.stdout);cached={saved:Date.now(),value};return value}).finally(()=>pending=null);
 return pending;
}
export function responseRequest(body,model){
 const input=(body.messages||[]).filter(m=>['system','developer','user','assistant'].includes(m.role)).map(m=>({role:m.role,content:typeof m.content==='string'?m.content:JSON.stringify(m.content)}));
 const req={model,input,stream:false,store:false};
 if(body.response_format?.type==='json_schema')req.text={format:{type:'json_schema',...body.response_format.json_schema}};
 else if(body.response_format?.type==='json_object')req.text={format:{type:'json_object'}};
 if(body.max_completion_tokens||body.max_tokens)req.max_output_tokens=body.max_completion_tokens||body.max_tokens;
 return req;
}
export function completionFromResponse(value,model){
 if(value.error)throw Error(value.error.message||'Model response error');
 if(value.status==='incomplete')throw Error('Model output incomplete');
 const content=(value.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 if(!content)throw Error('Empty model response');
 return {id:value.id||'memory-response',object:'chat.completion',model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:value.usage?.input_tokens||0,completion_tokens:value.usage?.output_tokens||0,total_tokens:value.usage?.total_tokens||0}};
}
export async function runModel(body,selection){
 const catalog=await modelCatalogue();
 if(!catalog.models.some(m=>m.id===selection.model&&m.provider===selection.provider))throw Error('所选模型已不在工作台对话模型列表中，请重新选择');
 const config=JSON.parse((await exec(python,[script,'--connection'],{timeout:10000,maxBuffer:65536})).stdout);
 const upstream=await fetch(config.baseUrl.replace(/\/$/,'')+'/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},body:JSON.stringify(responseRequest(body,selection.model)),signal:AbortSignal.timeout(240000)});
 const raw=await upstream.text();let value;
 if(raw.trimStart().startsWith('data:')||raw.includes('\nevent:')){
  for(const line of raw.split('\n'))if(line.startsWith('data:')){try{const e=JSON.parse(line.slice(5));if(e.type==='response.completed'||e.type==='response.incomplete')value=e.response;else if(e.type==='error'||e.type==='response.failed')value={error:e.error||e.response?.error||{message:'Model stream failed'}}}catch{}}
 }else{try{value=JSON.parse(raw)}catch{}}
 if(!upstream.ok)return {status:upstream.status,value:{error:{type:'upstream_error',message:value?.error?.message||'模型服务返回 '+upstream.status}}};
 if(!value)throw Error('Invalid model response');
 return {status:200,value:completionFromResponse(value,selection.model)};
}
