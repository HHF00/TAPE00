import type { Timeframe } from '../shared/types.ts';

export interface SavedChartSnapshot {
  id: string;
  filename: string;
  symbol: string;
  name: string;
  timeframe: Timeframe;
  priceLabel: string;
  patternSummary: string | null;
  theme: 'light' | 'dark';
  width: number;
  height: number;
  dataUrl: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ChartExportMeta {
  symbol: string;
  name: string;
  exchange: string;
  timeframe: Timeframe;
  priceLabel: string;
  changeLabel: string;
  isPositive: boolean;
  patternSummary: string | null;
  activeOverlays: string[];
  isDark: boolean;
}

const DB_NAME = 'tapescope_chart_snapshots_db';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const FALLBACK_STORAGE_KEY = 'tapescope_chart_snapshots_fallback_v1';
const MAX_STORED_SNAPSHOTS = 24;

function openSnapshotsDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readFallback(): SavedChartSnapshot[] {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFallback(items: SavedChartSnapshot[]): void {
  try {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(items.slice(0, 6)));
  } catch {
    // Ignore storage quota errors in fallback mode
  }
}

export async function listSavedChartSnapshots(): Promise<SavedChartSnapshot[]> {
  const db = await openSnapshotsDb();
  if (!db) {
    return readFallback().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = ((req.result as SavedChartSnapshot[]) || []).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        );
        resolve(list);
      };
      req.onerror = () => resolve(readFallback());
    } catch {
      resolve(readFallback());
    }
  });
}

export async function saveChartSnapshotToStorage(
  snapshot: SavedChartSnapshot
): Promise<SavedChartSnapshot[]> {
  const db = await openSnapshotsDb();
  if (!db) {
    const next = [snapshot, ...readFallback().filter((s) => s.id !== snapshot.id)].slice(
      0,
      MAX_STORED_SNAPSHOTS
    );
    writeFallback(next);
    return next;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  const all = await listSavedChartSnapshots();
  if (all.length > MAX_STORED_SNAPSHOTS) {
    const toRemove = all.slice(MAX_STORED_SNAPSHOTS);
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const item of toRemove) {
          store.delete(item.id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    return all.slice(0, MAX_STORED_SNAPSHOTS);
  }
  return all;
}

export async function deleteChartSnapshotFromStorage(
  id: string
): Promise<SavedChartSnapshot[]> {
  const db = await openSnapshotsDb();
  if (!db) {
    const next = readFallback().filter((s) => s.id !== id);
    writeFallback(next);
    return next;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  return listSavedChartSnapshots();
}

export async function clearChartSnapshotsFromStorage(): Promise<void> {
  const db = await openSnapshotsDb();
  if (!db) {
    try {
      localStorage.removeItem(FALLBACK_STORAGE_KEY);
    } catch {
      // ignore
    }
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function downloadPngDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

const SVG_PRESENTATION_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'paint-order',
  'visibility',
  'display',
] as const;

function inlineSvgComputedStyles(sourceRoot: SVGSVGElement, cloneRoot: SVGSVGElement, isDark: boolean): void {
  const haloColor = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.92)';
  const origNodes = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const cloneNodes = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];

  for (let i = 0; i < origNodes.length && i < cloneNodes.length; i++) {
    const orig = origNodes[i];
    const clone = cloneNodes[i];
    if (!(orig instanceof Element) || !(clone instanceof Element)) continue;

    // Remove interactive crosshair layer so exported PNG stays clean
    if (orig.getAttribute('data-chart-crosshair') === 'true') {
      clone.remove();
      continue;
    }

    const cs = window.getComputedStyle(orig);
    const styleParts: string[] = [];
    for (const prop of SVG_PRESENTATION_PROPS) {
      let val = cs.getPropertyValue(prop);
      if (!val) continue;
      if (val.includes('var(--chart-label-halo')) {
        val = haloColor;
      }
      styleParts.push(`${prop}:${val}`);
    }

    if (styleParts.length > 0) {
      const existing = clone.getAttribute('style') || '';
      const resolvedExisting = existing.replace(/var\(--chart-label-halo[^)]*\)/g, haloColor);
      clone.setAttribute(
        'style',
        resolvedExisting ? `${resolvedExisting};${styleParts.join(';')}` : styleParts.join(';')
      );
    }
  }
}

export async function exportChartLayoutAsPng(
  svgElement: SVGSVGElement,
  meta: ChartExportMeta
): Promise<SavedChartSnapshot> {
  const vb = svgElement.viewBox.baseVal;
  const svgW = vb && vb.width > 0 ? vb.width : svgElement.clientWidth || 1280;
  const svgH = vb && vb.height > 0 ? vb.height : svgElement.clientHeight || 508;

  const scale = 2; // Crisp Retina / 2x export
  const headerH = 68;
  const footerH = 34;
  const totalW = svgW;
  const totalH = headerH + svgH + footerH;

  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(svgW));
  clone.setAttribute('height', String(svgH));
  clone.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  inlineSvgComputedStyles(svgElement, clone, meta.isDark);

  const serializer = new XMLSerializer();
  const svgMarkup = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to rasterize chart SVG'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(totalW * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }

    ctx.scale(scale, scale);

    const bg = meta.isDark ? '#0f172a' : '#ffffff';
    const borderCol = meta.isDark ? '#1e293b' : '#e2e8f0';
    const textPrimary = meta.isDark ? '#f1f5f9' : '#0f172a';
    const textMuted = meta.isDark ? '#94a3b8' : '#64748b';
    const posCol = meta.isDark ? '#34d399' : '#059669';
    const negCol = meta.isDark ? '#fb7185' : '#e11d48';
    const accentCol = meta.isDark ? '#60a5fa' : '#2563eb';

    // Canvas backdrop
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, totalW, totalH);

    // Header band
    ctx.fillStyle = textPrimary;
    ctx.font = '700 20px "Space Grotesk", Inter, system-ui, sans-serif';
    ctx.fillText(meta.symbol, 20, 30);

    const symWidth = ctx.measureText(meta.symbol).width;
    ctx.fillStyle = textMuted;
    ctx.font = '500 13px Inter, system-ui, sans-serif';
    ctx.fillText(`${meta.name} · ${meta.exchange} · ${meta.timeframe.toUpperCase()}`, 20 + symWidth + 12, 29);

    // Pattern & overlay subtitle
    ctx.fillStyle = meta.patternSummary ? accentCol : textMuted;
    ctx.font = '600 11.5px "JetBrains Mono", ui-monospace, monospace';
    const subtitle = meta.patternSummary
      ? meta.patternSummary
      : 'Technical Price & Volume Analysis';
    ctx.fillText(subtitle, 20, 51);

    // Right side price + change
    ctx.textAlign = 'right';
    ctx.fillStyle = textPrimary;
    ctx.font = '700 19px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(meta.priceLabel, totalW - 20, 29);

    ctx.fillStyle = meta.isPositive ? posCol : negCol;
    ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(meta.changeLabel, totalW - 20, 49);
    ctx.textAlign = 'left';

    // Header divider line
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, headerH - 4);
    ctx.lineTo(totalW - 16, headerH - 4);
    ctx.stroke();

    // Draw Chart SVG
    ctx.drawImage(img, 0, headerH, svgW, svgH);

    // Footer band
    ctx.strokeStyle = borderCol;
    ctx.beginPath();
    ctx.moveTo(16, headerH + svgH + 4);
    ctx.lineTo(totalW - 16, headerH + svgH + 4);
    ctx.stroke();

    ctx.fillStyle = textMuted;
    ctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace';
    const overlaysLabel =
      meta.activeOverlays.length > 0
        ? `Layers: ${meta.activeOverlays.join(' · ')}`
        : 'Candlestick Price Action';
    ctx.fillText(overlaysLabel, 20, headerH + svgH + 22);

    ctx.textAlign = 'right';
    const stamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    ctx.fillText(`TapeScope Snapshot · ${stamp}`, totalW - 20, headerH + svgH + 22);
    ctx.textAlign = 'left';

    const dataUrl = canvas.toDataURL('image/png');
    const base64Len = dataUrl.split(',')[1]?.length || 0;
    const sizeBytes = Math.round((base64Len * 3) / 4);
    const now = new Date();
    const safeSym = meta.symbol.replace(/[^A-Za-z0-9._-]/g, '_');
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const filename = `${safeSym}-${meta.timeframe.toUpperCase()}-${now.getFullYear()}${pad2(
      now.getMonth() + 1
    )}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.png`;

    return {
      id: `snap_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      filename,
      symbol: meta.symbol,
      name: meta.name,
      timeframe: meta.timeframe,
      priceLabel: meta.priceLabel,
      patternSummary: meta.patternSummary,
      theme: meta.isDark ? 'dark' : 'light',
      width: canvas.width,
      height: canvas.height,
      dataUrl,
      sizeBytes,
      createdAt: now.toISOString(),
    };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
