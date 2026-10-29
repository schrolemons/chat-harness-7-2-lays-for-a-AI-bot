
export default {saveLabel:"保存冒泡数量上限",
      title: '定时主动消息',
      fields: [{ key: 'maxBubblesPerDay', label: '每天最多主动冒泡次数', help: '填 0 表示当天不主动冒泡；仍可正常回复收到的消息。', type: 'number', min: 0, max: 60 }]
    };
