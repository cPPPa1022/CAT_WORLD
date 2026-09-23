// scripts/selftest.js — v0.2：扫描→新世界→回合管线 冒烟测试
'use strict';
const G = require('../src/game');
const IMP = require('../src/import');
/* v2.05 修：不再直读仓库里的 config.json —— 那是**开发者本机的配置**（含 API Key），
   而引擎自己有 AI.loadConfig()（走 resBase()，用户数据目录）。 */
const AI = require('../src/ai');
const cfg = AI.loadConfig();

async function main() {
  // 1) 启发式扫描一张"卡"
  const card = { name: '柳如烟', description: '街边小店的老板娘，三十出头，离异，一个人守着店。眼睛很亮，但笑的时候从来眯着眼。', personality: '外冷内热，嘴上不饶人，背地里心软', first_mes: '雨夜里，你推开店门，她正擦着柜台，头也没抬：回来了？' };
  const scan = await IMP.scanCard(card, cfg);
  console.log('扫描模式: ' + scan.mode + ' | 时代: ' + scan.pack.meta.era + ' | 载体: ' + JSON.stringify(scan.pack.meta.carries));
  const data = IMP.packToData(scan.pack);
  console.log('世界: ' + data.meta.name + ' | 地点 ' + Object.values(data.entities).filter(e => e.type === 'place').length + ' 个 | NPC: ' + scan.pack.npcs.map(n => n.name).join(','));

  // 2) 回合
  const steps = ['你好，柳如烟？', '我要为自己的迟到道歉', '我睡觉', '去路口'];
  let view = null;
  for (const s of steps) {
    const r = await G.runTurn(data, s, cfg);
    view = r.view;
    console.log('\n== ' + s + ' == 意图:' + r.intent.kind + ' 应用:' + r.applied + ' 校验:' + (r.errors.length ? r.errors.join(';') : '无'));
    if (r.frame && r.frame.tag) console.log('  ' + r.frame.tag);
    for (const b of (r.frame || {}).beats || []) console.log('  [' + b.type + '] ' + b.text);
  }
  console.log('\n== 投影 ==');
  console.log('时间: ' + view.time.label + (view.time.precise ? '(精确)' : '(体感)') + ' 地点: ' + view.place.name + ' 未读:' + view.unread);
  console.log('派生行动: ' + (view.affordances || []).map(a => a.label).join(' | '));
  console.log('通讯录: ' + (view.phoneInfo.contacts || []).map(c => c.name).join(','));
  /* v2.05：V.carries 已从玩家视图里删除（前端 0 引用；载体在服务端已翻译成 V.tools）。
     这里本来想看的"新闻用哪个载体"，照实从世界数据里读。 */
  console.log('手机新闻载体: ' + ((data.meta.carries || {}).news || 'n/a') + ' | 前端工具: ' + (view.tools || []).map(t => t.name).join('/'));
  console.log('\nSELFTEST OK');
}
main().catch(e => { console.error('SELFTEST FAIL', e); process.exit(1); });
