/** Character-only effects. Frames are text, with no canvas, images, or external assets. */
export type AsciiMode = 'donut' | 'matrix';

export function asciiFrame(mode: AsciiMode, phase: number, width: number, height: number): string {
  const columns = Math.max(24, Math.min(76, Math.floor(width)));
  const rows = Math.max(10, Math.min(22, Math.floor(height)));
  if (mode === 'matrix') {
    const chars = '01.:+=*#';
    return Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => {
      if (x % 3 === 2) return ' ';
      const head = (Math.floor(phase * (4 + x % 5)) + x * 7) % (rows + 12);
      const distance = head - y;
      if (distance < 0 || distance > 9) return ' ';
      if (distance === 0) return '@';
      return chars[(x * 13 + y * 7 + Math.floor(phase * 5)) % chars.length];
    }).join('')).join('\n');
  }

  const buffer = Array<string>(columns * rows).fill(' ');
  const depth = new Float32Array(columns * rows);
  const palette = '.,-~:;=!*#$@';
  const a = phase * 0.54 + 0.65;
  const b = phase * 0.26 + 0.35;
  const sinA = Math.sin(a), cosA = Math.cos(a), sinB = Math.sin(b), cosB = Math.cos(b);
  const scale = Math.min(columns * 0.35, rows * 0.88);
  for (let theta = 0; theta < Math.PI * 2; theta += 0.09) {
    const ct = Math.cos(theta), st = Math.sin(theta);
    for (let phi = 0; phi < Math.PI * 2; phi += 0.035) {
      const cp = Math.cos(phi), sp = Math.sin(phi);
      const circle = 2 + ct;
      const x = circle * (cosB * cp + sinA * sinB * sp) - st * cosA * sinB;
      const y = circle * (sinB * cp - sinA * cosB * sp) + st * cosA * cosB;
      const z = 7 + cosA * circle * sp + st * sinA;
      const inverse = 1 / z;
      const px = Math.floor(columns / 2 + scale * 2.3 * x * inverse);
      const py = Math.floor(rows / 2 - scale * y * inverse);
      const luminance = cp * ct * sinB - cosA * ct * sp - sinA * st
        + cosB * (cosA * st - ct * sinA * sp);
      const offset = px + py * columns;
      if (px < 0 || px >= columns || py < 0 || py >= rows || inverse <= depth[offset]!) continue;
      depth[offset] = inverse;
      buffer[offset] = palette[Math.max(0, Math.min(palette.length - 1, Math.floor((luminance + 0.5) * 7))) ]!;
    }
  }
  return Array.from({ length: rows }, (_, row) => buffer.slice(row * columns, (row + 1) * columns).join('')).join('\n');
}

export class AsciiAnimation {
  private frame = 0;
  private phase = 0;
  private last = 0;
  private running = true;
  private visible = true;
  private readonly surface = document.createElement('pre');
  private readonly status = document.createElement('div');
  private readonly observer: IntersectionObserver;

  constructor(readonly element: HTMLElement, private mode: AsciiMode, private motion: boolean) {
    element.className = 'ascii-animation';
    element.dataset.mode = mode;
    this.surface.setAttribute('aria-hidden', 'true');
    this.status.className = 'ascii-caption';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', mode === 'donut' ? '由字符绘制的旋转圆环' : '字符雨');
    element.append(this.surface, this.status);
    this.observer = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? false;
      this.sync();
    });
    this.observer.observe(element);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.draw();
    this.sync();
  }

  private onVisibility = (): void => this.sync();
  private sync(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const active = this.running && this.motion && this.visible && !document.hidden;
    this.element.dataset.running = String(active);
    this.status.textContent = this.running
      ? `${this.mode} / ${active ? 'RUNNING' : 'STILL'}`
      : `${this.mode} / STOPPED`;
    if (active) this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (time: number): void => {
    if (time - this.last >= 80) {
      this.phase += 0.08;
      this.last = time;
      this.draw();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  private draw(): void {
    const columns = Math.min(68, Math.max(16, Math.floor(this.element.clientWidth / 8)));
    this.surface.textContent = asciiFrame(this.mode, this.phase, columns, columns < 40 ? 14 : 20);
  }
  setMotion(enabled: boolean): void { this.motion = enabled; this.sync(); }
  stop(): void {
    this.running = false;
    this.sync();
    this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
