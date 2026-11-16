import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';
const root=fileURLToPath(new URL('.',import.meta.url));
for(const [file,sha] of Object.entries(JSON.parse(readFileSync(root+'vendor/manifest.json'))))if(createHash('sha256').update(readFileSync(root+'vendor/'+file)).digest('hex')!==sha)throw Error('Workbench theme baseline changed: '+file);
const compiled=await transform(readFileSync(root+'vendor/themePalettes.ts','utf8'),{loader:'ts',format:'esm'});
const {BUILT_IN_THEMES,T3_CHAT_THEME}=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
const variables=JSON.parse(readFileSync(root+'vendor/theme-variables.json'));
let boot=readFileSync(root+'vendor/workbench-theme-bootstrap.js','utf8');
const anchor='document.documentElement.style.backgroundColor = chromeColor;';if(boot.split(anchor).length!==2)throw Error('Workbench theme bootstrap boundary changed');
boot=boot.replace(anchor,anchor+`
          for (const name of Object.values(memoryThemeVariables)) document.documentElement.style.removeProperty(name);
          if (effectiveIsThemed) {
            const fullTheme = effectiveCustomTheme || memoryThemePalettes.find(t=>t.id===effectiveThemeId);
            const fallback = effectiveThemeMode==='dark' ? memoryThemeDefault.variants.dark : memoryThemeDefault.colors;
            const colors = fullTheme && (effectiveThemeMode===fullTheme.appearance ? fullTheme.colors : fullTheme.variants?.[effectiveThemeMode]);
            for (const [role,name] of Object.entries(memoryThemeVariables)) {
              const value=isThemeColor(colors?.[role])?colors[role]:fallback[role];
              if(isThemeColor(value)) document.documentElement.style.setProperty(name,value);
            }
          }
`);
const out=`// Generated from the pinned workbench theme bootstrap and full palettes.\nconst memoryThemePalettes=${JSON.stringify(BUILT_IN_THEMES)};\nconst memoryThemeDefault=${JSON.stringify(T3_CHAT_THEME)};\nconst memoryThemeVariables=${JSON.stringify(variables)};\nfunction syncWorkbenchTheme(){${boot}}\nsyncWorkbenchTheme();\nwindow.addEventListener('storage',e=>{if(e.key===null||e.key?.startsWith('t3code:theme'))syncWorkbenchTheme()});\nwindow.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',syncWorkbenchTheme);\nwindow.addEventListener('pageshow',syncWorkbenchTheme);\n`;
writeFileSync(root+'web/theme.js',out);copyFileSync(root+'vendor/workbench.css',root+'web/workbench.css');
console.log('Built shared workbench theme: saved appearance, built-in/custom palettes, system changes');
