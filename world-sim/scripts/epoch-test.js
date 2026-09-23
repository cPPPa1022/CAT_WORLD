'use strict';
const G = require('../src/game');
const W = require('../src/world');
(async () => {
  const cfg = { llm: { baseURL: '', apiKey: '', model: '' } };
  const d = W.buildDemoWorld();
  d.entities.player.money.cash = 5000; // 测试买机用
  const r = await G.runTurn(d, '跳到2008年', cfg);
  const v = r.view;
  console.log('[1] 时代跳转 intent=', r.intent.kind, '| 当前时间=', v.time.label);
  console.log('[2] 商店是否有新机=', JSON.stringify((v.shop || []).map(s => s.name + '¥' + s.price)));
  console.log('[3] 时代新闻=', JSON.stringify(v.news.slice(-3).map(n => n.title)));
  console.log('[4] device=', JSON.stringify((v.tools || []).map(t => t.name)));
  // 买诺基亚
  const b = await G.runTurn(d, '买诺基亚N95', cfg);
  console.log('[5] 购买 intent=', b.intent.kind, '| cash=', b.view.money.cash, '| device=', JSON.stringify((b.view.tools || []).map(t => t.name + ':' + t.apps.join('/'))));
  console.log('[6] 玩家背包=', JSON.stringify(d.entities.player.inventory.map(x => x.name)));
  const b2 = await G.runTurn(d, '跳到2013年', cfg);
  console.log('[7] 2013 智能机上市?=', JSON.stringify(b2.view.shop.map(s => s.name + '¥' + s.price)));
  const b3 = await G.runTurn(d, '买触屏智能手机', cfg);
  console.log('[8] 换触屏=', JSON.stringify(b3.view.tools.map(t => t.name + ':' + t.apps.join('/'))), '| 时代=', v.overview.era);   // v2.05：V.meta 已从玩家视图里删除（外发零引用 + 含引擎字段）；时代读玩家可见的那份
})();
