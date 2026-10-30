
export default {saveLabel:"保存桌面便签设置", title: '桌面便签', fields: [
      { key: 'noteFileName', label: '便签文件名', group:'文件与字数设置',collapsed:true,maxLength:60,help: '悄悄话和故障摘要写入同一桌面 txt；只追加，不覆盖。这里只设置文件名。', type: 'text' },
      { key: 'maxNoteChars', label: '单条便签最大字数', help: '悄悄话过长会拒绝写入；自动故障摘要过长会按完整字符缩短。', type: 'number', min: 20, max: 2000 }
    ] };
