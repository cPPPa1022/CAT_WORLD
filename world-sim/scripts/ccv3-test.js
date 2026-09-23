'use strict';
const IMP = require('../src/import');
(async () => {
  // CCv3 完整形态（含 characters 多角色 + alternate_greetings + world book）
  const ccv3 = {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name: '老茶馆的夜晚', description: '1996年小镇老茶馆，雨夜。',
      personality: '闲适、话多', scenario: '你是来避雨的客人',
      first_mes: '你掀开棉帘，茶香扑面。', alternate_greetings: ['（雨更大了一点。）', '（炉子上的水开了。）'],
      mes_example: '<START>{{char}}:来，坐。',
      character_book: { entries: [{ keys: ['老周'], content: '老周坐庄，输的请茶钱。', enabled: true }] },
      characters: [
        { name: '老周', description: '茶馆掌柜，五十岁，袖口有烟灰', personality: '热络，算账精明' },
        { name: '茶客', description: '常来的熟客，爱下棋', personality: '话少，棋臭' }
      ],
      world: {} 
    }
  };
  const card = IMP.normalizeCard(ccv3);
  console.log('[1] normalize 主字段=', card.name, '| first_mes=', card.first_mes.slice(0, 12), '| 世界书条目=', (card.character_book && card.character_book.entries || []).length);
  const scan = await IMP.scanCard(card, { llm: { baseURL: '', apiKey: '', model: '' } });
  console.log('[2] 扫描模式=', scan.mode, '| NPC=', scan.pack.npcs.map(n => n.name).join(','));
  const data = IMP.packToData(scan.pack);
  const npcs = Object.values(data.entities).filter(e => e.type === 'person' && e.id !== 'player').map(e => e.name);
  console.log('[3] 生成世界NPC=', npcs.join(','), '| 世界书=>>>', Object.keys(data.worldinfo || {}).length, '条');
  // PNG 块路径模拟
  const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108020000009077F75B0000000C4944415408D763F8CFC0000003010100' + '18DD8DBD0000000049454E44AE426082', 'hex');
  // 仅验证 pngExtract 存在与 chara 未找到的报错路径
  try { IMP.pngExtract(png); console.log('[4] 空PNG→未找到chara（预期异常已吞掉）'); } catch (e) { console.log('[4] 空PNG报错=', e.message.slice(0, 30)); }
})();
