'use strict';
const AI = require('../src/ai');
const W = require('../src/world');
const d = W.buildDemoWorld();
// 无极端词 + 高情绪/关系 → 仍不预标
for (let i = 0; i < 6; i++) d.sceneLog.push({ type: 'dialogue', speaker: '沈姨', text: '和沈姨说说话' });
d.relations.player.npc_1.tone = '吵翻了';
d.entities.npc_1.state.mood = '愤怒';
console.log('[1] 无极端词 spotlight =', JSON.stringify(AI.spotlight(d)));
// 极端词在手（尾条含"摊牌"）+ 同上条件
d.sceneLog.push({ type: 'dialogue', speaker: '沈姨', text: '我今天摊牌了，沈姨' });
console.log('[2] 有极端词 spotlight =', JSON.stringify(AI.spotlight(d)));
