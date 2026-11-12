
// Collect only the E-layer configuration fields.
export function collectEConfig() { return {
adminDev: {
      enabled: document.getElementById('v2AdminDevEnabled').checked
    }
}; }
