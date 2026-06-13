// ============ 绘图相关类型 ============

export type ShapeType = 'circle' | 'rectangle' | 'square' | 'triangle' | 'ellipse' | 'line' | 'star' | 'arrow';

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
  stroke_width?: number;
  opacity?: number;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
  group_id?: string;
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
  target_id?: string;
  filter_type?: string;
  filter_color?: string;
  all?: boolean;
}

export interface QueryCanvasArgs {
  query_type: 'count' | 'largest' | 'smallest' | 'colors' | 'by_type';
  shape_type?: string;
}

// ============ 画布状态（用于 LLM 上下文注入）============

export interface CanvasObjectInfo {
  id: string;
  type: string;
  color: string;
  x: number;
  y: number;
  size: number;
  width?: number;
  height?: number;
  group_id?: string;
}

// ============ 确认机制 ============

export interface ConfirmAction {
  type: 'clear_canvas' | 'delete_multiple';
  details: string;
  toolCalls?: Array<{ function: { name: string; arguments: string } }>;
}

// ============ 语音相关类型 ============

export type VoiceState = 'idle' | 'listening' | 'processing' | 'executing' | 'confirming' | 'error';

export interface CommandRecord {
  id: string;
  userInput: string;
  systemUnderstanding: string;
  commandType: string;
  success: boolean;
  timestamp: number;
}
