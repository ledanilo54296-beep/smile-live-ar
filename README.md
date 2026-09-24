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

然后访问 `http://127.0.0.1:4179/smile-live-ar/`。静态资源随站点发布，无需模型 API 密钥或推理后端。运行时使用 FaceAPI 的 Tiny Face Detector、68 点轻量关键点和表情模型，三个模型原始大小合计约 600KB；模型与推理库在 Worker 内并行下载。推理使用 TensorFlow 的单线程 WASM 后端，支持 SIMD 时自动启用，不阻塞界面，不依赖 GPU 编译或跨源隔离。构建仅发布被代码引用的资源，不发布历史 MediaPipe 运行库或 Pose 文件。

## 交互验收

- 点击 `Start camera` 请求摄像头权限；视频就绪即显示画面，不等待识别模型。模型尚未就绪时显示 `Preparing effects...`，仍可拍照或停止摄像头；模型就绪后自动开始追踪。
- 中性表情不显示天气效果；轻微微笑时雨幕按笑容强度渐入。
- 大笑稳定超过阈值会触发三枚青/红/白烟花，触发有阈值回差和冷却时间。
- 界面用 `Big smile detected` 表示张嘴笑容：表情模型的笑容分数与嘴部张开比例共同判断；闭嘴微笑不会仅因为笑容分数饱和而触发烟花。它不是笑声识别或独立的大笑分类器。摄像头请求为 `audio: false`，不采集麦克风。
- 烟花爆点位于头顶及两侧；粒子通过连续检测与头部椭圆反射，避免高速穿透。
- 头部椭圆跟随实时人脸关键点；肩膀、手臂和其他身体部位不参与碰撞。
- 雨滴命中头部时显示短促水花和反弹水珠，烟花命中头部时显示短促星芒。
- 识别就绪后显示 `Smile for rain. Laugh for fireworks.`；持续大笑时保留 `Fireworks` 状态。雨声是低音量连续雨床加稀疏水滴，烟花声音按升空燃烧、爆炸冲击和爆炸后噼啪散落三段播放，均可关闭。
- 烟花由三档速度和五种颜色组成，并带双层拖尾、扩散光环和爆心星芒。
- 底部拍照按钮居中，左侧静音，右侧停止摄像头；体验固定使用前置摄像头镜像，避免移动端重新初始化摄像头造成长时间卡顿。
- 模型和推理库跟随站点发布，摄像头画面只在本设备处理，不会上传。

## 性能预算

- 摄像头预览目标 1280×720 / 24fps；人脸推理输入独立缩至 384px，避免为了识别牺牲预览清晰度。
- 表情推理在独立 Worker 中串行、自适应限频，没有帧队列堆积；视觉渲染最高 30fps、Canvas DPR 固定为 1。
- 雨滴最多 56、烟花粒子最多 180、碰撞火花最多 48；页面切到后台时暂停摄像头轨道和计算。
- `npm test` 验证高速粒子对头部的连续碰撞；运行时可在控制台读取 `window.__SMILE_LIVE_METRICS__`。
- `window.__SMILE_LIVE_METRICS__.startup` 记录模型开始/就绪、摄像头准备、点击到画面显示（`clickToPreviewMs`）、点击到首次推理完成（`clickToReadyMs`）和首次推理耗时。页面只在首次推理成功后进入可用状态。
- 所有浏览器使用相同的 Worker WASM 路径，识别调度间隔为 84–150ms；单次计算期间不堆积帧。Worker 无响应时会被终止，重试创建全新实例。防挂死超时不是性能验收标准。
- 浏览器需要支持 HTTPS 摄像头、Module Worker 和 OffscreenCanvas。浏览器或内置 WebView 的摄像头权限限制、断网与极慢连接仍会影响启动；不能把移动视口模拟测试当作实体手机实测。

## 浏览器功能验收

```bash
npx playwright install chromium
VITE_BASE_PATH=/smile-live-ar/ npm run build
VITE_BASE_PATH=/smile-live-ar/ npm run preview -- --port 4191
# 另一个终端中运行，也可将参数替换为线上 Demo 地址：
npm run test:browser -- http://127.0.0.1:4191/smile-live-ar/
```

测试用上游项目的人脸照片作为 Canvas 摄像头输入，运行真实模型，不注入表情分数或直接调用特效。它检查首次推理在 5 秒内完成、中性无雨、微笑下雨、大笑烟花、头部碰撞、持续笑容不重复触发、表情恢复后再次触发、关闭与重试，并保存手机/桌面截图与指标到 `artifacts/browser-chromium/`。照片只下载到忽略的测试目录，不随网站发布。`BROWSER_ENGINE=webkit` 可验证 WebKit；`BROWSER_PATH` 可指定已有 Chrome 可执行文件。测试通过不等同于所有网络和手机的速度保证。

Pages 工作流在真实模型浏览器验收通过后才上传部署产物，失败时保留浏览器结果供检查。
