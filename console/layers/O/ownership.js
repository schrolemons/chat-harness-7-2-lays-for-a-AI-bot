// Canonical page and source mount; internal helpers do not create cards.
export default {
  "obs-context-assembly": {"presentation":"internal","page":"context-visual"},
  "life-token-budget": {
    "page": "usage",
    "selector": "#section-usage"
  },
  "obs-bridge-health": {
    "presentation": "internal",
    "page": "operations"
  },
  "obs-cost-policy": {
    "page": "usage",
    "selector": "[data-component-slot=\"obs-cost-policy\"]"
  },
  "obs-health-monitor": {
    "page": "operations",
    "selector": "[data-component-slot=\"obs-health-monitor\"]"
  },
  "obs-self-review": {
    "page": "setting-o-2",
    "selector": "#v2SelfReviewEnabled"
  }
};
