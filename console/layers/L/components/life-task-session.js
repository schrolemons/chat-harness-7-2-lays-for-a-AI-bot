
export default {saveLabel:"保存独立任务设置",
      title: '独立 AI 任务',
      fields: [
        { key: 'maxConcurrentTasks', label: '同时进行的任务（个）', type: 'number', min: 1, max: 20 },
        { key: 'maxTasks', label: '任务记录保留数（条）', type: 'number', min: 3, max: 200 }
      ]
    };
