export default { title: '无人回复时结束本轮', saveLabel: '保存无人回复收尾概率', fields: [
  { key: 'endProbabilityPercent', label: '初始结束概率 p（%）', type: 'number', min: 0, max: 100 },
  { key: 'probabilityStepPercent', label: '每次增加 q（百分点）', type: 'number', min: 1, max: 100 }
] };
