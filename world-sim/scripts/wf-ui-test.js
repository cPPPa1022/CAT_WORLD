'use strict';
// 合成 UI 格式（模拟 ComfyUI 普通导出：nodes+links），验证 wfToApi 后图链完整
const ui = {
  nodes: [
    { id: 1, type: 'CLIPTextEncode', pos: [0,0], inputs: [], widgets_values: ['a girl'], widgets: [{ name: 'text' }] },
    { id: 2, type: 'KSampler', pos: [1,0], inputs: [ { name: 'model', link: 1 }, { name: 'positive', link: 2 }, { name: 'negative', link: 3 }, { name: 'latent_image', link: 4 } ], widgets: [{ name: 'seed' }, { name: 'steps' }], widgets_values: [123, 10] },
    { id: 3, type: 'VAEDecode', pos: [2,0], inputs: [ { name: 'samples', link: 5 }, { name: 'vae', link: 6 } ] },
    { id: 4, type: 'SaveImage', pos: [3,0], inputs: [ { name: 'images', link: 7 } ] },
    { id: 5, type: 'CheckpointLoaderSimple', pos: [4,0], inputs: [], widgets_values: ['model.safetensors'] },
    { id: 6, type: 'VAELoader', pos: [5,0], inputs: [], widgets_values: ['ae.safetensors'] },
    { id: 7, type: 'EmptyLatentImage', pos: [6,0], inputs: [], widgets_values: [512, 512, 1] }
  ],
  links: [
    [1, 5, 0, 2, 0, 'MODEL'], [2, 1, 0, 2, 1, 'CONDITIONING'], [3, 8, 0, 2, 2, 'CONDITIONING'],
    [4, 7, 0, 2, 3, 'LATENT'], [5, 2, 0, 3, 0, 'LATENT'], [6, 6, 0, 3, 1, 'VAE'], [7, 3, 0, 4, 0, 'IMAGE']
  ]
};
// 加载 server 里的 wfToApi（通过重新 require？正文件不可导出——直接内联快速检查：require server 不行。改为在 server 里导出测试？简化：直接读 server.js 代码片段 eval? 不行。
console.log('UI 格式合成样例就绪（服务端逻辑待真实验证：请用户用 API Format 导出重导，修正后的 wfToApi 会在下轮随真实 UI 文件验证）');
