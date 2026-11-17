import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
for(const name of ['file-download.ts','folder-upload.ts','upload-transport.ts','file-properties.ts','authorized-clients.js','connection-center.js','github-entry.js','wechat-entry.js','proxy-entry.js','motion.css']) {
 assert.equal(readFileSync(new URL('extensions/frontend/src/'+name,root),'utf8'),
  readFileSync(new URL('core/apps/web/src/extensions/'+name,root),'utf8'),name+' mirrors differ');
}
const component=readFileSync(new URL('core/apps/web/src/components/WorkbenchExtensions.tsx',root),'utf8');
for(const name of ['WorkbenchFolderUpload','WorkbenchConnectionCenter'])assert.ok(component.includes('<'+name+' />'));
assert.ok(readFileSync(new URL('core/apps/web/src/components/media/MediaActions.tsx',root),'utf8').includes('saveAttachment('));
const menu=readFileSync(new URL('core/apps/web/src/fileContextMenu.ts',root),'utf8');
assert.ok(menu.includes('sidecarAvailable = canRead && environmentId === primaryEnvironmentId'));
console.log('Maintained feature mirrors and core integrations agree');
