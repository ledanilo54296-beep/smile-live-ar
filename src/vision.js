export class FaceTracker {
  constructor(onStage) {
    this.worker = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.nextId = 0;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data);
    };
    this.worker.onerror = (event) => this.close(new Error(event.message || 'Face tracking worker failed'));
    onStage('loading assets');
    this.ready = this.request({ type: 'init' }, [], 30000).then(() => onStage('ready'));
  }

  request(message, transfers = [], timeout = 5000) {
    if (!this.worker) return Promise.reject(new Error('Face tracker is closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.close(new Error('Face tracking stopped responding')), timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id }, transfers);
    });
  }

  detect(image) {
    return this.request({ type: 'detect', width: image.width, height: image.height, pixels: image.data.buffer }, [image.data.buffer]);
  }

  close(error = new Error('Face tracker closed')) {
    this.worker?.terminate();
    this.worker = null;
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
}
