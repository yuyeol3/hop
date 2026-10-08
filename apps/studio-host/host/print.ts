// Prints the open document from upstream's portable page SVGs (embed RPC getPageSvg).
import type { StudioRpc } from './rpc';

const PRINT_ROOT_ID = 'hop-print-root';
const PRINT_STYLE_ID = 'hop-print-style';
const PRINT_PAGE_HEIGHT_GUARD_MM = 0.1;
const MM_PER_CSS_PX = 25.4 / 96;

export async function printDocument(rpc: StudioRpc, print: () => Promise<void>): Promise<void> {
  const pageCount = await rpc.request<number>('pageCount');
  if (!pageCount) return;

  const pages: string[] = [];
  for (let page = 0; page < pageCount; page += 1) {
    pages.push(await rpc.request<string>('getPageSvg', { page }));
  }
  const size = pageSizeMm(pages[0]);
  if (!size) throw new Error('인쇄할 쪽 크기를 알 수 없습니다.');

  const root = renderPrintShell(size);
  for (const svg of pages) appendPrintPage(root, svg);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const cleanup = () => {
    document.getElementById(PRINT_STYLE_ID)?.remove();
    document.getElementById(PRINT_ROOT_ID)?.remove();
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  try {
    await print();
  } catch (error) {
    window.removeEventListener('afterprint', cleanup);
    cleanup();
    throw error;
  }
}

export function pageSizeMm(svg: string): { widthMm: number; heightMm: number } | null {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const width = Number.parseFloat(root.match(/\swidth="([\d.]+)(?:px)?"/i)?.[1] ?? '');
  const height = Number.parseFloat(root.match(/\sheight="([\d.]+)(?:px)?"/i)?.[1] ?? '');
  if (!(width > 0 && height > 0)) return null;
  return { widthMm: Math.round(width * MM_PER_CSS_PX), heightMm: Math.round(height * MM_PER_CSS_PX) };
}

function renderPrintShell({ widthMm, heightMm }: { widthMm: number; heightMm: number }): HTMLElement {
  document.getElementById(PRINT_STYLE_ID)?.remove();
  document.getElementById(PRINT_ROOT_ID)?.remove();

  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  @media screen { #${PRINT_ROOT_ID} { display: none; } }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body > :not(#${PRINT_ROOT_ID}) { display: none !important; }
    #${PRINT_ROOT_ID} { display: block !important; width: ${widthMm}mm; margin: 0 !important; padding: 0 !important; }
    #${PRINT_ROOT_ID} .hop-print-page {
      width: ${widthMm}mm; height: calc(${heightMm}mm - ${PRINT_PAGE_HEIGHT_GUARD_MM}mm);
      margin: 0 !important; padding: 0 !important; overflow: hidden;
      break-after: page; page-break-after: always; background: #fff;
    }
    #${PRINT_ROOT_ID} .hop-print-page:last-child { break-after: auto; page-break-after: auto; }
    #${PRINT_ROOT_ID} svg { display: block; width: 100% !important; height: 100% !important; }
  }`;

  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  root.setAttribute('aria-hidden', 'true');
  document.head.appendChild(style);
  document.body.appendChild(root);
  return root;
}

function appendPrintPage(root: HTMLElement, svg: string): void {
  const page = document.createElement('div');
  page.className = 'hop-print-page';
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const element = parsed.documentElement;
  if (!parsed.querySelector('parsererror') && element.tagName.toLowerCase() === 'svg') {
    sanitizeSvg(element);
    page.appendChild(document.importNode(element, true));
  }
  root.appendChild(page);
}

function sanitizeSvg(root: Element): void {
  root.querySelectorAll('script, foreignObject, iframe, object, embed, link, meta').forEach((node) => node.remove());
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || value.includes('javascript:')) {
        element.removeAttribute(attribute.name);
      } else if (['href', 'src', 'xlink:href'].includes(name) && !isSafePrintSvgReference(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

export function isSafePrintSvgReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === ''
    || normalized.startsWith('#')
    || /^data:image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml);/.test(normalized);
}
