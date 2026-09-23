'use strict';
const AI = require('../src/ai');
const samples = ["她把茶推了推，示意我喝。（思考：她刚才提到「沈家」，和账本对得上……）可能是试探。","【分析】这场戏的重点是信息差\n所以她不会先开口。\n她看着你。","思考：要不要让她看见信封？\n最后她还是把信封收进了抽屉。","<think>1. 她是谁 2. 疑点 3. 铺垫</think>（正常文本）","正常的一句话——没有思考内容。"];
for (const s of samples) console.log('IN : ' + String(s).slice(0, 30) + '\nOUT: ' + AI.stripThink(s) + '\n');
process.exit(0);
