import {saveV2Config} from './config-save.js';
export function initialize(){document.querySelectorAll('.v2-save').forEach(button=>button.addEventListener('click',()=>saveV2Config(button)));}
