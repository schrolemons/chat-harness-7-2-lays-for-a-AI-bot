
export default { title: '失败回归', fields: [{ key: 'maxCases', label: '最多保留的回归用例', help: '用于限制回归记录数量，避免无限增长。', type: 'number', min: 5, max: 1000 }] };
