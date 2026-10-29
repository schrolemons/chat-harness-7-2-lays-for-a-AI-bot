// Static assertions inspect the owning modules; browser tests use the real document/compiled assets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConsoleDocument } from '../src/console/document.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function readConsoleTestSource() {
  function scripts(dir) {
    return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()) return scripts(file);
      if(!entry.name.endsWith('.js')) return [];
      const source=fs.readFileSync(file,'utf8').replace(/^import .+;\s*$/gm,'').replace(/export default /g,'const componentSpec = ').replace(/^export \{[^}]*\};?\s*$/gm,'').replace(/\bexport (?=(?:async )?function|const |let )/g,'');
      return ['<script>\n'+source+'\n</script>'];
    });
  }
  return renderConsoleDocument(root) + scripts(path.join(root,'console')).join('\n');
}
