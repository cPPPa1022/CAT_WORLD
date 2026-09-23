// electron-main.js — 世界模拟器桌面窗口（动态端口 · 无锁 · 日志 · 软渲染）
'use strict';
const DEG = require('./src/degraded');
const { app, BrowserWindow, dialog } = require('electron');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');

app.disableHardwareAcceleration();

const LOG = require('node:path').join(os.tmpdir(), 'worldsim.log');
const log = (s) => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + s + '\n'); } catch (e) { DEG.hit("electron-main.js", e); } };

function pickPort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => { tryPort(p + 1); });
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(p)));
    };
    tryPort(start);
  });
}

app.whenReady().then(async () => {
  log('ready');
  const PORT = await pickPort(3088);
  process.env.PORT = String(PORT);
  process.env.WORLD_SIM_ASSETS = __dirname;
  process.env.WORLD_SIM_DATA = app.getPath('userData');
  log('port=' + PORT + ' data=' + app.getPath('userData'));
  let srv;
  try {
    srv = require('./server');
  } catch (e) {
    log('server fail: ' + String(e.message || e));
    dialog.showErrorBox('小猫的世界', '服务启动失败：' + String(e.message || e));
    app.quit();
    return;
  }
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1024, minHeight: 700,
    title: '小猫的世界 · v2.07', backgroundColor: '#0a0e12', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, allowScriptsToClose: true }
  });
  // 等服务真正绑定成功（端口冲突时 server 会自动 +1 重试），用实际端口加载
  let loaded = false;
  const load = () => {
    if (loaded) return; loaded = true;
    const actual = (srv.__actualPort && srv.__actualPort()) || PORT;
    log('load url port=' + actual);
    win.loadURL('http://127.0.0.1:' + actual);
  };
  if (srv.listening) load();
  else srv.on('listening', load);
  // 兜底：8 秒仍未监听 → 提示并退出（避免白窗口无限等）
  setTimeout(() => {
    if (!loaded) {
      log('server never listening');
      dialog.showErrorBox('小猫的世界', '服务启动失败：端口始终被占用（' + PORT + ' 起 20 个都被占）。请检查是否有多个进程/端口冲突，然后重开。');
      app.quit();
    }
  }, 8000);
  win.webContents.on('console-message', (e, level, msg) => { try { fs.appendFileSync(require('node:path').join(os.tmpdir(), 'worldsim-ui.log'), level + '|' + String(msg) + '\n'); } catch (err) { DEG.hit("electron-main.js", err); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F5' || (input.control && (input.key === 'r' || input.key === 'R'))) { win.webContents.reload(); e.preventDefault(); }
  });
  win.on('closed', () => app.quit());
  app.on('window-all-closed', () => app.quit());
  log('window ok');
});