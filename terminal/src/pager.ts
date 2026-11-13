import type { ShellLine } from './shell';

interface PagerOptions {
  mode: 'more' | 'less';
  label: string;
  lines: ShellLine[];
  output: HTMLElement;
  renderLines: (target: HTMLElement, lines: ShellLine[]) => void;
  onExit: () => void;
}
interface RowBounds { top: number; bottom: number }

/** A temporary terminal viewport. Clipping never creates a second scroll area. */
export class Pager {
  readonly element = document.createElement('section');
  private readonly viewport = document.createElement('div');
  private readonly content = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly rows: HTMLElement[];
  private readonly observer: ResizeObserver;
  private bounds: RowBounds[] = [];
  private offset = 0;
  private height = 1;
  private totalHeight = 0;
  private lineHeight = 24.5;
  private frame = 0;
  private active = true;

  constructor(private readonly options: PagerOptions) {
    const { mode, label, lines, output } = options;
    this.element.className = 'pager';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', `${mode} 分页阅读`);
    this.element.tabIndex = -1;
    const title = document.createElement('div');
    title.className = 'pager-label';
    title.textContent = `${mode} ${label}`;
    title.title = title.textContent;
    const controls = document.createElement('div');
    controls.className = 'pager-controls';
    this.previous = this.button('previous', '↑ 上一页', '上一页', () => this.move(-this.height));
    this.next = this.button('next', '↓ 下一页', '下一页', () => this.move(this.height));
    controls.append(this.previous, this.next, this.button('close', 'q 退出', '退出分页', options.onExit));
    this.status.className = 'pager-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    const help = document.createElement('div');
    help.className = 'pager-help muted';
    help.textContent = 'Space / b 翻页 · j/k 移动 · g/G 首尾 · q 退出';
    this.viewport.className = 'pager-window';
    this.content.className = 'pager-content';
    options.renderLines(this.content, lines);
    this.rows = Array.from(this.content.children) as HTMLElement[];
    this.viewport.append(this.content);
    this.element.append(title, controls, this.status, help, this.viewport);
    output.append(this.element);
    this.element.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
    this.measure();
    this.observer = new ResizeObserver(this.scheduleMeasure);
    this.observer.observe(this.content);
    window.addEventListener('resize', this.scheduleMeasure);
    window.visualViewport?.addEventListener('resize', this.scheduleMeasure);
    void document.fonts.ready.then(this.scheduleMeasure);
  }

  private button(name: string, text: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pager-${name} text-command`;
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => { onClick(); });
    return button;
  }

  private readonly scheduleMeasure = (): void => {
    if (!this.active || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; if (this.active) this.measure(); });
  };

  private measure(): void {
    // Keep the same authored line in view after wrapping, font or orientation changes.
    const anchor = this.bounds.findIndex(row => row.bottom > this.offset + 0.5);
    const old = this.bounds[anchor];
    const fraction = old ? Math.max(0, (this.offset - old.top) / (old.bottom - old.top)) : 0;
    const top = this.content.getBoundingClientRect().top;
    this.bounds = this.rows.map(row => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top - top, bottom: rect.bottom - top };
    });
    this.totalHeight = this.bounds.at(-1)?.bottom ?? 0;
    this.lineHeight = parseFloat(getComputedStyle(this.content).lineHeight) || 24.5;
    const footerElement = document.querySelector('.status-line');
    const footerStyle = footerElement ? getComputedStyle(footerElement) : null;
    const footer = (footerElement?.getBoundingClientRect().height ?? 40)
      + (parseFloat(footerStyle?.marginBottom ?? '0') || 0) + (parseFloat(footerStyle?.marginTop ?? '0') || 0);
    const padding = parseFloat(getComputedStyle(document.querySelector('#scrollback')!).paddingBottom) || 0;
    const available = (window.visualViewport?.height ?? innerHeight)
      - (this.viewport.getBoundingClientRect().top + window.scrollY) - footer - padding - 12;
    this.height = Math.max(this.lineHeight, Math.floor(available / this.lineHeight) * this.lineHeight);
    this.height = Math.min(this.height, Math.max(this.lineHeight, this.totalHeight));
    this.viewport.style.height = `${this.height}px`;
    const next = this.bounds[anchor];
    if (next) this.offset = next.top + Math.floor(fraction * (next.bottom - next.top) / this.lineHeight) * this.lineHeight;
    this.offset = Math.min(Math.max(0, this.offset), this.lastOffset);
    this.draw();
  }

  private get lastOffset(): number { return Math.max(0, this.totalHeight - this.height); }
  private get atEnd(): boolean { return this.offset >= this.lastOffset - 0.5; }

  private draw(): void {
    this.content.style.transform = `translateY(${-this.offset}px)`;
    let first = -1;
    let last = -1;
    this.rows.forEach((row, index) => {
      const box = this.bounds[index];
      const visible = box.bottom > this.offset + 0.5 && box.top < this.offset + this.height - 0.5;
      row.style.visibility = visible ? '' : 'hidden';
      if (visible) { if (first === -1) first = index; last = index; }
    });
    const percentage = this.totalHeight ? Math.min(100, Math.round((this.offset + this.height) / this.totalHeight * 100)) : 100;
    this.status.textContent = `${first + 1}–${last + 1} / ${this.rows.length} 行 · ${this.atEnd ? 'END' : `${percentage}%`}`;
    this.status.dataset.start = String(first + 1);
    this.status.dataset.end = String(last + 1);
    this.status.dataset.total = String(this.rows.length);
    this.previous.disabled = this.offset <= 0.5;
    this.next.disabled = this.atEnd;
    this.element.dataset.offset = String(this.offset);
  }

  private move(distance: number): void {
    this.offset = Math.max(0, Math.min(this.lastOffset, this.offset + distance));
    this.draw();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  handleKey(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229 || event.altKey || event.metaKey) return;
    const key = event.key;
    if (event.ctrlKey) {
      if (key.toLowerCase() === 'c') {
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        this.options.onExit();
      } else if (key.toLowerCase() === 'd' || key.toLowerCase() === 'u') {
        event.preventDefault();
        const half = Math.max(this.lineHeight, Math.floor(this.height / this.lineHeight / 2) * this.lineHeight);
        this.move(key.toLowerCase() === 'd' ? half : -half);
      } else if (key.toLowerCase() === 'l') { event.preventDefault(); this.scheduleMeasure(); }
      return;
    }
    // Space and Enter retain native button/link activation when a control is focused.
    if ((key === ' ' || key === 'Enter') && event.target instanceof Element && event.target.closest('button, a')) return;
    if (key === 'q' || key === 'Escape') { event.preventDefault(); this.options.onExit(); }
    else if (key === ' ' || key === 'PageDown' || key === 'f') {
      event.preventDefault();
      if (this.atEnd) this.options.onExit(); else this.move(this.height);
    } else if (key === 'b' || key === 'PageUp') { event.preventDefault(); this.move(-this.height); }
    else if (key === 'j' || key === 'ArrowDown' || key === 'Enter') { event.preventDefault(); this.move(this.lineHeight); }
    else if (key === 'k' || key === 'ArrowUp') { event.preventDefault(); this.move(-this.lineHeight); }
    else if (key === 'g') { event.preventDefault(); this.move(-this.offset); }
    else if (key === 'G') { event.preventDefault(); this.move(this.lastOffset); }
  }

  get summary(): string { return `${this.options.mode} ${this.options.label} · ${this.status.textContent} · 已退出`; }
  get output(): HTMLElement { return this.options.output; }

  dispose(): void {
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    window.removeEventListener('resize', this.scheduleMeasure);
    window.visualViewport?.removeEventListener('resize', this.scheduleMeasure);
    this.element.remove();
  }
}
