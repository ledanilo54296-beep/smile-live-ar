// The mask and landmarks share the uncropped camera frame, including mirroring.
export function coverTransform(videoWidth, videoHeight, width, height, mirrored) {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const sx = videoWidth * scale;
  const sy = videoHeight * scale;
  return { sx: mirrored ? -sx : sx, sy, ox: mirrored ? (width + sx) / 2 : (width - sx) / 2, oy: (height - sy) / 2 };
}

export function copySilhouette(mask, previous, transform, now) {
  const width = Math.min(160, mask.width);
  const height = Math.max(1, Math.round(mask.height * width / mask.width));
  const data = previous?.data.length === width * height ? previous.data : new Float32Array(width * height);
  const source = mask.getAsFloat32Array();
  let foreground = 0;
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(mask.height - 1, Math.floor((y + 0.5) * mask.height / height)) * mask.width;
    for (let x = 0; x < width; x += 1) {
      const value = source[row + Math.min(mask.width - 1, Math.floor((x + 0.5) * mask.width / width))];
      if (!Number.isFinite(value)) return null;
      data[y * width + x] = value;
      if (value >= 0.5) foreground += 1;
    }
  }
  // Failed GPU readback can return all zeroes without throwing an exception.
  if (!foreground || foreground === data.length) return null;
  return { data, width, height, ...transform, updatedAt: now };
}

function sample(mask, x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= mask.width - 1 || iy >= mask.height - 1) return 0;
  const fx = x - ix;
  const fy = y - iy;
  const index = iy * mask.width + ix;
  const a = mask.data[index] * (1 - fx) + mask.data[index + 1] * fx;
  const b = mask.data[index + mask.width] * (1 - fx) + mask.data[index + mask.width + 1] * fx;
  return a * (1 - fy) + b * fy;
}

export function segmentSilhouetteIntersection(x0, y0, x1, y1, mask) {
  const startX = (x0 - mask.ox) / mask.sx * mask.width - 0.5;
  const startY = (y0 - mask.oy) / mask.sy * mask.height - 0.5;
  const dx = (x1 - x0) / mask.sx * mask.width;
  const dy = (y1 - y0) / mask.sy * mask.height;
  if (sample(mask, startX, startY) >= 0.5) return null;
  // Sub-cell steps catch thin arms even when a fast drop crosses between frames.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
  for (let step = 1; step <= steps; step += 1) {
    let hi = step / steps;
    if (sample(mask, startX + dx * hi, startY + dy * hi) < 0.5) continue;
    let lo = (step - 1) / steps;
    for (let i = 0; i < 5; i += 1) {
      const mid = (lo + hi) * 0.5;
      if (sample(mask, startX + dx * mid, startY + dy * mid) >= 0.5) hi = mid;
      else lo = mid;
    }
    const x = startX + dx * hi;
    const y = startY + dy * hi;
    let nx = 0;
    let ny = 0;
    for (let offset = -1; offset <= 1; offset += 1) {
      nx += sample(mask, x - 1, y + offset) - sample(mask, x + 1, y + offset);
      ny += sample(mask, x + offset, y - 1) - sample(mask, x + offset, y + 1);
    }
    nx *= mask.width / mask.sx;
    ny *= mask.height / mask.sy;
    const length = Math.hypot(nx, ny);
    if (length < 0.000001) return null;
    return { t: hi, x: x0 + (x1 - x0) * hi, y: y0 + (y1 - y0) * hi, normalX: nx / length, normalY: ny / length };
  }
  return null;
}
