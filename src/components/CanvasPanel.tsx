import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import { Canvas, Circle, Rect, Triangle, Ellipse, Text } from 'fabric';
import type { CreateShapeArgs, ModifyShapeArgs, CanvasObjectInfo } from '@/types/drawing';

// ============ 颜色映射 ============
const COLOR_MAP: Record<string, string> = {
  red: '#FF0000', blue: '#0066FF', green: '#00CC00', yellow: '#FFD700',
  orange: '#FF8C00', purple: '#9B59B6', pink: '#FF69B4', black: '#000000',
  white: '#FFFFFF', gray: '#808080', grey: '#808080',
  cyan: '#00CED1', brown: '#8B4513',
  红色: '#FF0000', 蓝色: '#0066FF', 绿色: '#00CC00', 黄色: '#FFD700',
  橙色: '#FF8C00', 紫色: '#9B59B6', 粉色: '#FF69B4', 黑色: '#000000',
  白色: '#FFFFFF',
};

function resolveColor(c: string): string {
  return COLOR_MAP[c] || COLOR_MAP[c.toLowerCase()] || c;
}

// ============ 坐标修正（基于实际画布尺寸）============
function snapCoordinate(x: number, y: number, w: number, h: number) {
  const threshold = Math.min(w, h) * 0.04;
  const snapX = [w * 0.1, w * 0.25, w * 0.5, w * 0.75, w * 0.9];
  const snapY = [h * 0.1, h * 0.25, h * 0.5, h * 0.75, h * 0.9];

  for (const sx of snapX) {
    if (Math.abs(x - sx) < threshold) { x = sx; break; }
  }
  for (const sy of snapY) {
    if (Math.abs(y - sy) < threshold) { y = sy; break; }
  }

  const margin = 20;
  return {
    x: Math.max(margin, Math.min(w - margin, x)),
    y: Math.max(margin, Math.min(h - margin, y)),
  };
}

// ============ 组件 ============
export interface CanvasPanelRef {
  createShape: (args: CreateShapeArgs) => string;
  modifyShape: (args: ModifyShapeArgs) => boolean;
  deleteShape: (targetId: string) => boolean;
  clearCanvas: () => void;
  getCanvasState: () => CanvasObjectInfo[];
  getCanvasJSON: () => object;
  getObjectCount: () => number;
  undo: () => void;
}

export const CanvasPanel = forwardRef<CanvasPanelRef>((_props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const sizeRef = useRef({ w: 800, h: 600 });
  const idCounter = useRef(0);
  const historyRef = useRef<string[]>([]);
  const [ready, setReady] = useState(false);

  // 初始化画布（响应容器尺寸）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    sizeRef.current = { w, h };

    const canvasEl = document.createElement('canvas');
    canvasEl.width = w;
    canvasEl.height = h;
    container.appendChild(canvasEl);

    const canvas = new Canvas(canvasEl, {
      backgroundColor: '#fafafa',
      selection: false,
    });
    canvasRef.current = canvas;

    historyRef.current.push(JSON.stringify(canvas.toObject(['customId'])));
    setReady(true);

    return () => {
      canvas.dispose();
      if (container && canvasEl.parentNode === container) {
        container.removeChild(canvasEl);
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    createShape: (args: CreateShapeArgs): string => {
      const canvas = canvasRef.current;
      if (!canvas) return '';

      const { w, h } = sizeRef.current;
      const id = `obj_${++idCounter.current}`;
      const color = resolveColor(args.color || '#333333');

      // 根据画布实际尺寸按比例计算默认尺寸
      const baseSize = Math.min(w, h) * 0.12;
      const size = args.size ? (args.size / 80) * baseSize : baseSize;

      // 默认为画布中心，按实际尺寸映射
      let x = args.center_x != null ? (args.center_x / 800) * w : w / 2;
      let y = args.center_y != null ? (args.center_y / 600) * h : h / 2;
      const snapped = snapCoordinate(x, y, w, h);
      x = snapped.x;
      y = snapped.y;

      const commonProps = {
        left: x,
        top: y,
        originX: 'center' as const,
        originY: 'center' as const,
        fill: color,
        opacity: args.opacity ?? 1,
        stroke: args.stroke_color ? resolveColor(args.stroke_color) : undefined,
        strokeWidth: args.stroke_color ? 2 : 0,
        customId: id,
        selectable: false,
        evented: false,
      };

      let obj: Circle | Rect | Triangle | Ellipse | Text | null = null;

      switch (args.shape_type) {
        case 'circle':
          obj = new Circle({ ...commonProps, radius: size });
          break;
        case 'rectangle':
        case 'square':
          obj = new Rect({
            ...commonProps,
            width: size * (args.shape_type === 'rectangle' ? 1.5 : 1),
            height: size,
          });
          break;
        case 'triangle':
          obj = new Triangle({ ...commonProps, width: size, height: size });
          break;
        case 'ellipse':
          obj = new Ellipse({ ...commonProps, rx: size * 1.3, ry: size * 0.8 });
          break;
        default:
          obj = new Circle({ ...commonProps, radius: size });
      }

      if (obj) {
        canvas.add(obj);
        canvas.requestRenderAll();
        historyRef.current.push(JSON.stringify(canvas.toObject(['customId'])));
      }

      return id;
    },

    clearCanvas: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.getObjects().forEach((o) => canvas.remove(o));
      canvas.requestRenderAll();
      historyRef.current.push(JSON.stringify(canvas.toObject(['customId'])));
    },

    modifyShape: (args: ModifyShapeArgs): boolean => {
      const canvas = canvasRef.current;
      if (!canvas) return false;

      const { w, h } = sizeRef.current;
      const obj = canvas.getObjects().find((o: any) => o.customId === args.target_id);
      if (!obj) return false;

      if (args.color) obj.set('fill', resolveColor(args.color));
      if (args.center_x != null) obj.set('left', (args.center_x / 800) * w);
      if (args.center_y != null) obj.set('top', (args.center_y / 600) * h);
      if (args.scale != null) obj.scale(args.scale);
      if (args.rotation != null) obj.rotate(args.rotation);
      if (args.opacity != null) obj.set('opacity', args.opacity);

      obj.setCoords();
      canvas.requestRenderAll();
      historyRef.current.push(JSON.stringify(canvas.toObject(['customId'])));
      return true;
    },

    deleteShape: (targetId: string): boolean => {
      const canvas = canvasRef.current;
      if (!canvas) return false;

      const obj = canvas.getObjects().find((o: any) => o.customId === targetId);
      if (!obj) return false;

      canvas.remove(obj);
      canvas.requestRenderAll();
      historyRef.current.push(JSON.stringify(canvas.toObject(['customId'])));
      return true;
    },

    getCanvasState: (): CanvasObjectInfo[] => {
      const canvas = canvasRef.current;
      if (!canvas) return [];

      const { w, h } = sizeRef.current;
      return canvas.getObjects().map((obj: any) => {
        let type = 'unknown';
        let size = 0;

        if (obj.type === 'circle' && obj.radius != null) {
          type = 'circle';
          size = obj.radius;
        } else if (obj.type === 'rect') {
          type = (obj.width === obj.height) ? 'square' : 'rectangle';
          size = Math.max(obj.width || 0, obj.height || 0);
        } else if (obj.type === 'triangle') {
          type = 'triangle';
          size = Math.max(obj.width || 0, obj.height || 0);
        } else if (obj.type === 'ellipse') {
          type = 'ellipse';
          size = Math.max(obj.rx || 0, obj.ry || 0);
        }

        return {
          id: obj.customId || '',
          type,
          color: obj.fill || '#333333',
          x: Math.round((obj.left / w) * 800),
          y: Math.round((obj.top / h) * 600),
          size: Math.round(size),
        };
      });
    },

    getObjectCount: (): number => {
      return canvasRef.current?.getObjects().length ?? 0;
    },

    getCanvasJSON: () => {
      return canvasRef.current?.toObject(['customId']) ?? {};
    },

    undo: () => {
      const canvas = canvasRef.current;
      if (!canvas || historyRef.current.length <= 1) return;
      historyRef.current.pop();
      const prev = historyRef.current[historyRef.current.length - 1];
      canvas.loadFromJSON(prev).then(() => canvas.requestRenderAll());
    },
  }), [ready]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
        border: '1px solid rgba(0,0,0,0.06)',
      }}
    />
  );
});

CanvasPanel.displayName = 'CanvasPanel';
