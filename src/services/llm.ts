import OpenAI from 'openai';

/**
 * LLM 服务提供商配置
 * Phase 0 阶段仅作为占位，Phase 1 接入实际调用
 */

interface LLMProvider {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const providers: LLMProvider[] = [
  {
    name: 'DeepSeek',
    apiKey: import.meta.env.VITE_DEEPSEEK_API_KEY || '',
    baseUrl: `${window.location.origin}/api/llm/deepseek`,
    model: 'deepseek-chat',
  },
  {
    name: 'Qwen',
    apiKey: import.meta.env.VITE_QWEN_API_KEY || '',
    baseUrl: `${window.location.origin}/api/llm/qwen`,
    model: 'qwen-max',
  },
  {
    name: 'Zhipu',
    apiKey: import.meta.env.VITE_ZHIPU_API_KEY || '',
    baseUrl: `${window.location.origin}/api/llm/zhipu`,
    model: 'glm-4-flash',
  },
];

class LLMService {
  /**
   * 多模型故障转移调用
   * 按优先级依次尝试: DeepSeek → Qwen → Zhipu
   */
  async callWithFailover(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  ): Promise<{ provider: string; response: OpenAI.Chat.Completions.ChatCompletion }> {
    const errors: string[] = [];

    for (const provider of providers) {
      if (!provider.apiKey) {
        errors.push(`${provider.name}: 未配置 API Key`);
        continue;
      }

      try {
        const client = new OpenAI({
          apiKey: provider.apiKey,
          baseURL: provider.baseUrl,
          dangerouslyAllowBrowser: true,
        });

        const response = await client.chat.completions.create({
          model: provider.model,
          messages,
          tools,
          tool_choice: 'auto',
        });

        return { provider: provider.name, response };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.name}: ${msg}`);
        console.warn(`[${provider.name}] 调用失败，尝试下一个:`, msg);
      }
    }

    throw new Error(`所有模型提供商均不可用:\n${errors.join('\n')}`);
  }

  /**
   * 获取当前可用的提供商列表（用于 UI 展示）
   */
  getAvailableProviders(): string[] {
    return providers.filter((p) => !!p.apiKey).map((p) => p.name);
  }
}

export const llmService = new LLMService();

/**
 * Function Calling 工具定义
 * Phase 1 使用
 */
export const drawingTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_shape',
      description: '在画布上创建一个新的图形。对于复合对象（如房子、花朵、太阳），分解为多个基本图形并多次调用此工具，所有子图形使用相同的 group_id。',
      parameters: {
        type: 'object',
        properties: {
          shape_type: {
            type: 'string',
            enum: ['circle', 'rectangle', 'square', 'triangle', 'ellipse', 'line', 'star'],
            description: '图形类型。circle=圆形, rectangle=矩形, square=正方形, triangle=三角形, ellipse=椭圆, line=线段, star=五角星',
          },
          color: {
            type: 'string',
            description: '填充颜色，如 "red", "#FF5733", "蓝色"。线段类型此参数无效，用 stroke_color。',
          },
          center_x: {
            type: 'number',
            description: '中心点 x 坐标（0-800 逻辑坐标系）',
          },
          center_y: {
            type: 'number',
            description: '中心点 y 坐标（0-600 逻辑坐标系）',
          },
          size: {
            type: 'number',
            description: '尺寸（圆形=半径，矩形=边长，星形=外径），默认 80。"大"=120，"小"=50',
          },
          stroke_color: {
            type: 'string',
            description: '边框颜色（可选）。对 line 类型来说是线段颜色。',
          },
          stroke_width: {
            type: 'number',
            description: '边框/线段宽度（可选，默认 2，线段默认 3）',
          },
          opacity: {
            type: 'number',
            description: '透明度 0-1，默认 1',
          },
          start_x: {
            type: 'number',
            description: '线段起点 x 坐标（仅 line 类型使用）',
          },
          start_y: {
            type: 'number',
            description: '线段起点 y 坐标（仅 line 类型使用）',
          },
          end_x: {
            type: 'number',
            description: '线段终点 x 坐标（仅 line 类型使用）',
          },
          end_y: {
            type: 'number',
            description: '线段终点 y 坐标（仅 line 类型使用）',
          },
          group_id: {
            type: 'string',
            description: '分组 ID，用于复合对象。同一复合对象的所有子图形使用相同的 group_id（如 "house_1", "flower_1"）',
          },
        },
        required: ['shape_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modify_shape',
      description: '修改画布上已有图形的属性',
      parameters: {
        type: 'object',
        properties: {
          target_id: {
            type: 'string',
            description: '目标图形的 ID，从画布状态中获取',
          },
          color: { type: 'string', description: '新的填充颜色' },
          center_x: { type: 'number', description: '新的 x 坐标' },
          center_y: { type: 'number', description: '新的 y 坐标' },
          scale: { type: 'number', description: '缩放倍数' },
          rotation: { type: 'number', description: '旋转角度（度）' },
          opacity: { type: 'number', description: '透明度 0-1' },
        },
        required: ['target_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_shape',
      description: '删除画布上的图形',
      parameters: {
        type: 'object',
        properties: {
          target_id: {
            type: 'string',
            description: '目标图形的 ID',
          },
        },
        required: ['target_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_canvas',
      description: '清空画布上的所有图形',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_canvas',
      description: '查询画布状态信息',
      parameters: {
        type: 'object',
        properties: {
          query_type: {
            type: 'string',
            enum: ['count', 'largest', 'smallest', 'colors', 'by_type'],
            description: '查询类型',
          },
        },
        required: ['query_type'],
      },
    },
  },
];
