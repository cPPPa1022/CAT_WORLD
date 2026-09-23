---
name: catworld-dev
description: 小猫的世界（world-sim）改码 / 验证 / 打包 / 交付的固定流程：版本号四处同步、全量 node --check、临时数据目录冒烟、dist 部署、已知坑排查与文档同步。
whenToUse: 在 world-sim 里新增或修改任何 server.js / src/*.js / public/*（含 index.html、app.js、style.css）之后；打包 Electron 或要求用户验证 GUI 之前。
---

# 小猫的世界 · 开发与交付流程

## 0. 事实基线
- 代码根：`D:\\AI项目库\\小猫的世界\\world-sim\\`（零依赖 Node ≥18 + 单页 UI + Electron 壳）。
- 设计尺子：仓库根 `设计总稿.md`（§0-§21，一切验收标准）。
- 工程映射：仓库根 `交接文档.md`（模块↔板块表 + §6.x 变更记录 + §6 坑位手册）。
- 当前版本 **v1.10**（`server.js` 与 `public/app.js` 的 BUILD 常量必须一致，不一致前端 boot() 会弹警告）。
- 回归资产：`world-sim/scripts/` 43 个脚本（`npm test` 只跑 `scripts/selftest.js`，不是全量）。

## 1. 改完必跑（顺序固定）
```powershell
cd 'D:\\AI项目库\\小猫的世界\\world-sim'
# 1) 语法：全部源文件都要过（漏一个就可能整站白屏）
$f = @('server.js','public/app.js','electron-main.js') + (Get-ChildItem src -Filter *.js | % { 'src/'+$_.Name })
foreach ($x in $f) { node --check $x; if ($LASTEXITCODE -ne 0) { "FAIL $x" } }
```
```powershell
# 2) 冒烟：临时数据目录隔离，绝不碰用户数据（%APPDATA%/world-sim）
cd 'D:\\AI项目库\\小猫的世界\\world-sim'
$env:PORT='3899'; $env:WORLD_SIM_DATA='D:\\AI项目库\\小猫的世界\\.tmp-smoke\\data'; $env:WORLD_SIM_ASSETS='D:\\AI项目库\\小猫的世界\\world-sim'
Start-Job { node server.js } | Out-Null; Start-Sleep 2
node scripts/api-smoke.js      # 期望：build=v1.10 / 买牛奶 cash=47 / tools / sceneArt 行数
```
冒烟断言（core）：demo 后 `view.place.name=转角杂货铺`；买牛奶 → `money.cash 52→47` 且背包有牛奶；卖牛奶 → 回到 52；`/api/worlds` 有 1 条；读档后地点正确。

## 2. 版本号同步（4 处，缺一处就有"看不懂"的旧副本 bug）
1. `server.js` BUILD 常量
2. `public/app.js` BUILD 常量
3. `electron-main.js` 窗口标题
4. `public/index.html` 的 `?v=N` 缓存戳
打包交付时再加 `dist-app/世界模拟器/VERSION.txt` 与 `说明.txt`。

## 3. 部署到 dist（用户实际运行的是 dist，不是源码）
```powershell
cd 'D:\\AI项目库\\小猫的世界\\world-sim'
Copy-Item server.js,electron-main.js 'dist-app\\世界模拟器\\resources\\app\\' -Force
Copy-Item src\\*.js 'dist-app\\世界模拟器\\resources\\app\\src\\' -Force
Copy-Item public\\* 'dist-app\\世界模拟器\\resources\\app\\public\\' -Force
```
Electron 运行时：数据在 `%APPDATA%/world-sim/`，资产在 `resources/app`（env 双分离，见 `src/store.js` resBase/resAssets）。

## 4. 验证责任划分（重要）
- agent 可信：`node --check`、离线脚本、HTTP 冒烟（键值断言）。
- agent 不可信（历史）：**任何 GUI 结论**（沙箱起不了 Electron）。
- **2026-09-10 更新**：视野打开了——① 原生视觉已打通（模型配置里声明 `input: [text, image]` 后 `read_image` 直接可用，截图能自己看）；② **UI 验收门可用**：`catworld-harness` §6 的 dsh-verify CLI（真实 Chromium，PASS/FAIL + 截图 + 控制台断言；实测 world-sim 菜单→进游戏 11 条断言全绿）；③ `dsh-builtin-browser` 的 33 个 `browser_*` 已装（依赖 electron 二进制，profile 重装会冲掉 → 见 `dsh-market` §4.8）。GUI 不再是盲区：**起 `npm run start:web`（同一套 UI）→ 真实浏览器跑 spec → `read_image` 看截图**，可用于复现 §6.9 这类只在浏览器里出现的 bug。
- 但**终验仍然是用户**：真实 Electron 壳（窗口标题/托盘/GPU 灰屏/F5 刷新）只能用户点。自查给结论、用户给验收，并把三处指纹（窗口标题版本 / 主菜单 buildline / 左下 `JS✔`）报给用户。

## 5. 工具坑（本会话实测）
- **Shell 真身是 Windows PowerShell 5.1，不是 pwsh 7**：`pwsh` 不在 PATH（会 CommandNotFound），`.ps1` 被执行策略禁止（`running scripts is disabled`）→ **命令一律内联进 command 参数**，别写 .ps1 再调用。这也解释了下面两条编码坑（5.1 的 `Get-Content`/`Invoke-RestMethod` 默认非 UTF-8）。
- **沙箱边界（workspace-write）**：① 工作区外写入直接 EPERM（`%LOCALAPPDATA%`、`~/.dsh`、插件 node_modules）；② **带管道 stdio 的子进程 spawn 也 EPERM** —— 浏览器/Electron 这类进程在受限模式下根本起不来，要在宿主进程（插件工具）里跑，或一次性提权自测。
- **绝不用 pwsh 发中文 HTTP body**：`Invoke-RestMethod -Body '{"text":"买牛奶"}'` 到服务端会变成乱码 → 意图解析落到 `question`，看起来像"功能坏了"。中文请求一律走 `node`（`fetch`/现有 `scripts/api-smoke.js`），或显式 UTF-8 字节。
- `Get-Content` 读带中文注释的源文件会乱码（GBK 解码）——读文本用 read 工具，不用 shell。
- `read(limit<n)` + `write` 会截断文件；改文件先 read 全文再用 edit（old_string 必须与磁盘逐字一致）。
- 写含 `\n` 的 JS 字符串用拼接或 `String.fromCharCode(10)`，写完立刻 `node --check`。

## 6. 运行时坑位速查（详见交接文档 §6）
| 症状 | 先查 |
|---|---|
| 弹 EADDRINUSE / 打不开 | `netstat -ano | findstr 3088`，杀残留；listen 已绑 127.0.0.1 且自动 +1 |
| 全灰 / 点了没反应 | 窗口标题版本 → buildline → 左下 JS✔ → `%TEMP%/worldsim-ui.log`、`%TEMP%/worldsim.log`；80% 是旧进程/旧副本 |
| 输入框打不了字 | busy 卡死（submit 必须 finally 解锁） |
| 名字/印象错乱 | 显示没走 `viewName` 门控，或重复实体（loadWorld 自动 mergeDupPersons） |

## 7. 交付同时更新文档
1. `交接文档.md` §6.x 追加一条变更记录（版本 / 数据字段 / 新增模块 / 测试脚本 / 已知未做）。
2. 若改了设计约定，先改 `设计总稿.md` 对应章节，再改代码。
3. 新增测试脚本登记到交接文档 §8（每天改完必跑）。
