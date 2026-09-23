// presets.js — 预设注册（内置仅保留“无”；其余预设全部由用户导入）
'use strict';
const PRESETS = {
  none: { name: '无预设（普通直叙）', style: '' }
};
function pick(id) { return PRESETS[id] || PRESETS.none; }
module.exports = { PRESETS, pick };