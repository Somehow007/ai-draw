// ============ 绘图相关类型 ============

export type ShapeType = 'circle' | 'rectangle' | 'square' | 'triangle' | 'ellipse' | 'line' | 'arrow';

export type SemanticPosition =
  | 'center'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  | 'top' | 'bottom' | 'left' | 'right';

export interface CanvasObject {
  id: string;
  type: ShapeType;
  color: string;
  x: number;
  y: number;
  size: number;
  strokeColor?: string;
  opacity: number;
  rotation: number;
}

// ============ 指令相关类型 ============

export type CommandType =
  | 'create_shape'
  | 'modify_shape'
  | 'delete_shape'
  | 'clear_canvas'
  | 'query_canvas';

export interface CreateShapeArgs {
  shape_type: ShapeType;
  color?: string;
  center_x?: number;
  center_y?: number;
  size?: number;
  stroke_color?: string;
  opacity?: number;
}

export interface ModifyShapeArgs {
  target_id: string;
  color?: string;
  center_x?: number;
  center_y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
}

export interface DeleteShapeArgs {
  target_id: string;
}

export interface QueryCanvasArgs {
  query_type: 'count' | 'largest' | 'smallest' | 'colors' | 'by_type';
}

// ============ 画布状态（用于 LLM 上下文注入）============

export interface CanvasObjectInfo {
  id: string;
  type: string;
  color: string;
  x: number;
  y: number;
  size: number;
}

// ============ 语音相关类型 ============

export type VoiceState = 'idle' | 'listening' | 'processing' | 'executing' | 'error';

export interface CommandRecord {
  id: string;
  userInput: string;
  systemUnderstanding: string;
  commandType: CommandType | 'unknown';
  success: boolean;
  timestamp: number;
}
