
// Collect only the E-layer configuration fields.
export function collectEConfig() { return {
adminDev: {
      enabled: document.getElementById('v2AdminDevEnabled').checked,
      preset: String(document.getElementById('v2AdminDevPreset').value ?? '').trim().slice(0, 64)
    }
}; }
