import assert from 'node:assert/strict';import {allowed} from '../auth-policy.mjs';
const read=['filesystem:read','orchestration:read'];
assert.equal(allowed({authenticated:false,permissions:[...read,'access:write']},'/memory/'),false);
assert.equal(allowed({authenticated:true,permissions:read},'/memory/'),false);
assert.equal(allowed({authenticated:true,permissions:[...read,'access:write']},'/memory/'),true);
assert.equal(allowed({authenticated:true,permissions:[...read,'access:write']},'/api/cocloud/memory/control'),false);
assert.equal(allowed({authenticated:true,permissions:[...read,'access:write','orchestration:operate']},'/api/cocloud/memory/control'),true);
console.log('Memory auth regression passed: unauthenticated and limited/guest sessions denied; owner read and control scopes checked');

for(const endpoint of ['model','profile']){assert.equal(allowed({authenticated:true,permissions:[...read,'access:write']},'/api/cocloud/memory/'+endpoint),false);assert.equal(allowed({authenticated:true,permissions:[...read,'access:write','orchestration:operate']},'/api/cocloud/memory/'+endpoint),true)}
