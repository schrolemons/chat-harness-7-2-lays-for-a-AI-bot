
export default {saveLabel:"保存独立任务容量",
      title: '任务委派会话',
      fields: [
        { key: 'maxConcurrentTasks', label: '并发任务上限', type: 'number', min: 1, max: 20 },
        { key: 'maxTasks', label: '累计任务上限', type: 'number', min: 3, max: 200 }
      ]
    };
