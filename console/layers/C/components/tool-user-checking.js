
export default {saveLabel:"保存桌面便签设置", title: '桌面便签', fields: [
      { key: 'noteFileName', label: '便签文件名', help: '固定写入桌面；这里只能设置文件名，不能选择其他目录。便签始终自动添加时间戳。', type: 'text' },
      { key: 'maxNoteChars', label: '单条便签最大字数', help: '限制每次追加的便签长度。', type: 'number', min: 20, max: 2000 }
    ] };
