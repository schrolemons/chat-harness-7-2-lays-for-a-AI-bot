
export let slangEntriesCache = [];
export let slangSelected = new Set();
export let slangActiveTab = 'candidate';
export let slangModalId = null;
export let slangModalMode = 'confirm';
export function setSlangActiveTab(value) { slangActiveTab = value; }
export function setSlangEntriesCache(value) { slangEntriesCache = value; }
export function setSlangModalId(value) { slangModalId = value; }
export function setSlangModalMode(value) { slangModalMode = value; }
