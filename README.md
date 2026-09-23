# SMILE/LIVE AR

一个面向直播间的浏览器 AR 互动原型：用户打开摄像头后，轻微微笑会唤起雨幕，大笑会点燃烟花；雨滴和烟花粒子会与实时追踪的头部发生反弹、飞溅。

- **Live Demo**：[打开 SMILE/LIVE AR](https://ledanilo54296-beep.github.io/smile-live-ar/)
- **Source Code**：[公开 GitHub 仓库](https://github.com/ledanilo54296-beep/smile-live-ar)
- **部署状态**：[GitHub Actions](https://github.com/ledanilo54296-beep/smile-live-ar/actions/workflows/deploy.yml)

## 运行

```bash
npm install
npm start
```

然后打开 [http://127.0.0.1:4178/](http://127.0.0.1:4178/)。不要直接双击 `index.html`，因为浏览器会阻止本地文件加载 ES 模块、WASM 和摄像头权限。摄像头在 `localhost` 或 HTTPS 页面中可用。生产构建：

macOS 也可以双击项目根目录的 `启动.command`，它会启动服务并自动打开浏览器。

```bash
npm run build
npm run serve
```

生产预览地址是 [http://127.0.0.1:4179/](http://127.0.0.1:4179/)。如果 4178 或 4179 已被占用，先关闭旧的 Vite 进程，或使用 `npm run dev -- --port 4180` 临时换端口。

## GitHub Pages 部署

仓库的 Settings → Pages → Source 选择 **GitHub Actions**。推送到 `main` 后，工作流会安装锁定依赖、运行测试、构建并发布；任一步失败都会阻止新版本上线。后续更新继续使用相同的 Pages 链接。

```bash
git add .
git commit -m "Update AR experience"
git push
```

构建使用 Pages 提供的站点子路径，模型和 WASM 跟随 `BASE_URL` 加载。可在本地模拟仓库子路径：

```bash
VITE_BASE_PATH=/smile-live-ar/ npm run build
VITE_BASE_PATH=/smile-live-ar/ npm run serve
```

然后访问 `http://127.0.0.1:4179/smile-live-ar/`。静态资源随站点发布，无需模型 API 密钥或推理后端；首次访问需要下载人脸模型和所选 WASM，不能用 JS 压缩体积代表完整加载成本。界面加载后低优先级预加载人脸模型，与运行库加载重叠，浏览器复用同一份响应。历史 Pose 模型不提交、不发布，当前功能不依赖它。

## 交互验收

- 点击 `Start camera` 请求摄像头权限；视频就绪即显示画面，不等待识别模型。模型尚未就绪时显示 `Preparing effects...`，仍可拍照或停止摄像头；模型就绪后自动开始追踪。
- 中性表情不显示天气效果；轻微微笑时雨幕按笑容强度渐入。
- 大笑稳定超过阈值会触发三枚青/红/白烟花，触发有阈值回差和冷却时间。
- 界面用 `Big smile detected` 表示高强度笑容表情：根据嘴角和脸颊 blendshape 加权分数判断，不是声音识别，也不是独立的大笑分类器。摄像头请求明确为 `audio: false`，不会采集麦克风；静音按钮仅控制合成音效播放。
- 烟花爆点位于头顶及两侧；粒子通过连续检测与头部椭圆反射，避免高速穿透。
- 当前只启用 Face Landmarker；肩膀、手臂和其他身体部位不参与物理碰撞，避免低精度姿态估计造成错位反馈。
- 雨滴命中头部时显示短促水花和反弹水珠，烟花命中头部时显示短促星芒。
- 识别就绪后显示 `Effects ready`，右上角呈现识别状态；雨声是低音量连续雨床加稀疏水滴，烟花声音按升空燃烧、爆炸冲击和爆炸后噼啪散落三段播放，均可关闭。
- 烟花由三档速度和五种颜色组成，并带双层拖尾、扩散光环和爆心星芒。
- 底部拍照按钮居中，左侧静音，右侧停止摄像头；体验固定使用前置摄像头镜像，避免移动端重新初始化摄像头造成长时间卡顿。
- MediaPipe 推理、WASM 和模型均为本地资源，视频不会上传。

## 性能预算

- 摄像头预览目标 1280×720 / 24fps；人脸推理输入独立缩至 384px，避免为了识别牺牲预览清晰度。
- 表情推理自适应限频；视觉渲染最高 30fps、Canvas DPR 固定为 1。
- 雨滴最多 56、烟花粒子最多 180、碰撞火花最多 48；页面切到后台时暂停摄像头轨道和计算。
- `npm test` 验证高速粒子对头部的连续碰撞；运行时可在控制台读取 `window.__SMILE_LIVE_METRICS__`。
- `window.__SMILE_LIVE_METRICS__.startup` 记录模型开始/就绪的页面相对时间、摄像头准备耗时、点击到画面显示（`clickToPreviewMs`）、点击到识别就绪（`clickToReadyMs`）以及首次推理耗时；缓存、网络、设备和权限确认时间都会影响这些数字。预加载只减少串行等待，不减少约 6.7MB 的首次模型/WASM 压缩传输量，不承诺任意设备首次秒开。
- 模型初始化超过 18 秒会明确提示加载失败并允许重试，不会永远停在 `Preparing effects...`。
- 微信内置浏览器强制使用 CPU 委托，规避部分 iOS/Android WebView 的 GPU 初始化卡死；桌面浏览器仍优先使用 GPU，推理频率会按设备耗时自适应。
