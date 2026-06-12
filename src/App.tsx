import { useState, useRef, useCallback, useEffect } from 'react';
import { CanvasPanel, type CanvasPanelRef } from './components/CanvasPanel';
import { VoiceButton } from './components/VoiceButton';
import { llmService, drawingTools } from './services/llm';
import { speechService } from './services/speech';
import { correctASRText, hasCorrections } from './services/textCorrection';
import type { VoiceState, CommandRecord, CreateShapeArgs, ModifyShapeArgs } from './types/drawing';
import './App.css';

// ============ 日志工具 ============
const LOG_PREFIX = '[AI-Draw]';

function logInfo(tag: string, ...args: any[]) {
  console.log(`${LOG_PREFIX} [${tag}]`, ...args);
}

function logError(tag: string, ...args: any[]) {
  console.error(`${LOG_PREFIX} [${tag}]`, ...args);
}

// ============ System Prompt ============
const SYSTEM_PROMPT = `你是一个语音绘图助手。用户通过语音向你发出绘图指令。你必须且只能通过工具调用（tool calls）来执行操作，绝对不要用文字回复用户。

## 语音识别纠错
用户的指令来自语音识别，可能包含同音字错误。请你根据绘图上下文自动理解正确意图：
- "T型" / "提醒" / "体型" → 实际是"梯形"
- "举行" / "巨形" / "具形" → 实际是"矩形"
- "园形" / "园型" / "原型" → 实际是"圆形"
- "三角行" / "三角型" → 实际是"三角形"
- "正方型" / "正方向" → 实际是"正方形"
- 颜色词也可能出错："拦色"→蓝色, "皇色"→黄色, "路色"→绿色, "城色"→橙色
你不需要告诉用户你纠正了什么，直接按纠正后的意图生成工具调用即可。

## 画布坐标系
逻辑坐标系为 800×600（x: 0-800, y: 0-600），左上角为原点。

## 默认规则
- 未指定位置 → 画布中心 (400, 300)
- 未指定大小 → size=80（"大的"=120，"小的"=50）
- 未指定颜色 → #333333
- 修改/删除图形时，通过 target_id 引用画布状态中的对象
- 复合指令（"画一个圆和一个方形"）→ 返回多个工具调用

## 复合对象绘制规则
当用户要求画复杂对象（房子、花朵、太阳、小狗、树、汽车等）时：
1. 选择一个中心锚点作为整个对象的基准位置
2. 将对象分解为 3-12 个基本图形组件
3. 形状选择指南：
   - 圆形/球体 → circle
   - 方形/建筑墙体 → rectangle
   - 屋顶/尖顶 → triangle
   - 身体/椭圆部分 → ellipse
   - 四肢/枝干/连接 → line
   - 星星/装饰 → star
4. 从后往前依次调用 create_shape（先画背景层，再画前景层）
5. 同一复合对象的所有子图形必须使用相同的 group_id（如 "house_1", "flower_1"）

参考分解示例：
- 房子 = 矩形(墙体) + 三角形(屋顶) + 小矩形(门) + 小矩形(窗户) + 小矩形(烟囱)
- 太阳 = 黄色圆形(太阳本体) + 多条线段(光芒向四周放射)
- 花朵 = 圆形(花蕊,黄色) + 多个椭圆(花瓣,围绕花蕊) + 线段(花茎) + 椭圆(叶子)
- 树 = 矩形(树干,棕色) + 多个椭圆/圆形(树冠,绿色,上下堆叠)
- 小狗 = 椭圆(身体) + 圆形(头) + 两个椭圆(耳朵) + 四条线段(腿) + 线段(尾巴) + 小圆形(眼睛)
- 汽车 = 矩形(车身) + 小矩形(车窗) + 两个圆形(车轮) + 小三角形(车头)`;

// ============ LLM Tool Call 执行器 ============
async function executeToolCalls(
  canvas: CanvasPanelRef,
  toolCalls: Array<{ function: { name: string; arguments: string } }>,
): Promise<{ results: string[]; hasQuery: boolean; queryResult?: string }> {
  const results: string[] = [];
  let hasQuery = false;
  let queryResult = '';

  for (const tc of toolCalls) {
    const fn = tc.function;
    let args: Record<string, any>;
    try {
      args = JSON.parse(fn.arguments);
    } catch {
      results.push(`解析参数失败: ${fn.arguments}`);
      continue;
    }

    switch (fn.name) {
      case 'create_shape': {
        const id = canvas.createShape(args as CreateShapeArgs);
        results.push(`创建 ${args.shape_type}${args.color ? ` (${args.color})` : ''}: ${id}`);
        break;
      }
      case 'modify_shape': {
        const ok = canvas.modifyShape(args as ModifyShapeArgs);
        results.push(ok ? `修改 ${args.target_id}` : `未找到 ${args.target_id}`);
        break;
      }
      case 'delete_shape': {
        const ok = canvas.deleteShape(args.target_id);
        results.push(ok ? `删除 ${args.target_id}` : `未找到 ${args.target_id}`);
        break;
      }
      case 'clear_canvas': {
        canvas.clearCanvas();
        results.push('清空画布');
        break;
      }
      case 'query_canvas': {
        hasQuery = true;
        const count = canvas.getObjectCount();
        const state = canvas.getCanvasState();
        switch (args.query_type) {
          case 'count':
            queryResult = `画布上共有 ${count} 个图形`;
            break;
          case 'colors':
            queryResult = `颜色: ${[...new Set(state.map((o) => o.color))].join(', ')}`;
            break;
          default:
            queryResult = `画布状态: ${count} 个图形`;
        }
        results.push(queryResult);
        break;
      }
      default:
        results.push(`未知工具: ${fn.name}`);
    }
  }

  return { results, hasQuery, queryResult };
}

// ============ 主组件 ============
function App() {
  const canvasRef = useRef<CanvasPanelRef>(null);
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [feedback, setFeedback] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [llmProvider, setLlmProvider] = useState('');
  const historyEndRef = useRef<HTMLDivElement>(null);

  // 初始化语音识别
  useEffect(() => {
    speechService.onResult(
      (interim) => setInterimText(interim),
      (final) => {
        setFinalText(final);
        setInterimText('');
        processVoiceCommand(final.trim());
      },
    );

    speechService.onError(() => {
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 2000);
    });

    speechService.onEnd(() => {
      setVoiceState((prev) => (prev === 'listening' ? 'idle' : prev));
    });
  }, []);

  // 指令自动滚动
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [commands]);

  // 切换语音识别
  const toggleVoice = useCallback(() => {
    if (speechService.listening) {
      speechService.stop();
      setVoiceState('idle');
    } else {
      setFinalText('');
      setInterimText('');
      setFeedback('');
      speechService.start();
      setVoiceState('listening');
    }
  }, []);

  // 核心流程：语音文本 → 纠错 → LLM → 执行
  const processVoiceCommand = useCallback(async (rawText: string) => {
    if (!rawText) {
      setVoiceState('idle');
      return;
    }

    // ====== ASR 文本纠错（Layer 1 + Layer 2）======
    const correctedText = correctASRText(rawText);
    logInfo('语音识别', '原始文本:', rawText);
    if (hasCorrections(rawText, correctedText)) {
      logInfo('文本纠错', `纠正: "${rawText}" → "${correctedText}"`);
    }

    // L0: 快速指令（不走 LLM，用纠正后的文本）
    const t = correctedText.toLowerCase();
    if (t.includes('清空') || t.includes('清除')) {
      canvasRef.current?.clearCanvas();
      setVoiceState('executing');
      setFeedback('✓ 清空画布');
      addRecord(correctedText, '清空画布', true);
      setTimeout(() => setVoiceState('idle'), 1500);
      return;
    }
    if (t.includes('撤销') || t.includes('回退')) {
      canvasRef.current?.undo();
      setVoiceState('executing');
      setFeedback('✓ 撤销上一步');
      addRecord(correctedText, '撤销上一步', true);
      setTimeout(() => setVoiceState('idle'), 1500);
      return;
    }

    // 进入 LLM 处理
    setVoiceState('processing');

    try {
      const canvasState = canvasRef.current?.getCanvasState() ?? [];
      const stateDesc = canvasState.length === 0
        ? '[]（画布为空）'
        : JSON.stringify(canvasState, null, 2);

      logInfo('LLM请求', '画布状态:', stateDesc);

      const messages = [
        { role: 'system' as const, content: `${SYSTEM_PROMPT}\n\n当前画布对象:\n${stateDesc}` },
        { role: 'user' as const, content: correctedText },
      ];

      const { provider, response } = await llmService.callWithFailover(messages, drawingTools);
      setLlmProvider(provider);

      // ====== LLM 响应日志 ======
      logInfo('LLM响应', '模型提供商:', provider);
      const message = response.choices?.[0]?.message;
      logInfo('LLM响应', '消息内容:', message?.content || '(无文字内容)');
      const toolCalls = message?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        logInfo('LLM响应', `工具调用 (${toolCalls.length} 个):`);
        toolCalls.forEach((tc, i) => {
          logInfo('LLM响应', `  [${i + 1}] ${tc.function.name}(${tc.function.arguments})`);
        });
      }

      if (!toolCalls || toolCalls.length === 0) {
        const content = message?.content;
        setVoiceState('error');
        setFeedback(content ? `AI: ${content}` : '未理解该指令，请换种方式描述');
        addRecord(correctedText, content || '无法理解', false);
        logError('LLM响应', '未返回工具调用，文字内容:', content);
        setTimeout(() => setVoiceState('idle'), 2000);
        return;
      }

      // 执行工具调用
      setVoiceState('executing');
      if (canvasRef.current) {
        const { results, hasQuery, queryResult } = await executeToolCalls(canvasRef.current, toolCalls);
        const summary = hasQuery ? queryResult! : results.join('; ');
        logInfo('执行结果', summary);
        setFeedback(`✓ ${summary}`);
        addRecord(correctedText, summary, true);
      }

      setTimeout(() => setVoiceState('idle'), 2000);
    } catch (err) {
      // ====== 完整错误日志 ======
      logError('LLM调用', '发生错误:', err);
      if (err instanceof Error) {
        logError('LLM调用', '错误名称:', err.name);
        logError('LLM调用', '错误消息:', err.message);
        logError('LLM调用', '错误堆栈:', err.stack);
        if ('cause' in err) {
          logError('LLM调用', '错误原因:', (err as any).cause);
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      setVoiceState('error');
      setFeedback(`错误: ${msg.slice(0, 100)}`);
      addRecord(correctedText, `错误: ${msg.slice(0, 50)}`, false);
      setTimeout(() => setVoiceState('idle'), 3000);
    }
  }, []);

  function addRecord(input: string, understanding: string, success: boolean) {
    const record: CommandRecord = {
      id: Date.now().toString(),
      userInput: input,
      systemUnderstanding: understanding,
      commandType: 'create_shape',
      success,
      timestamp: Date.now(),
    };
    setCommands((prev) => [...prev, record]);
    setTimeout(() => setFeedback(''), 5000);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI 语音绘图工具</h1>
        {llmProvider && <span className="provider-badge">{llmProvider}</span>}
      </header>

      <div className="app-body">
        <div className="canvas-area">
          <div className="canvas-wrapper">
            <CanvasPanel ref={canvasRef} />
          </div>
          <div className="canvas-hints">
            <span>试试说：</span>
            {[
              '画一个红色的圆',
              '画两个绿色的梯形',
              '画蓝色矩形在右上角',
              '画一个房子',
              '画一朵花',
              '画一个太阳',
              '把圆形改成绿色',
              '画布上有几个图形',
              '清空画布',
            ].map((h) => (
              <span key={h} className="hint-chip">{h}</span>
            ))}
          </div>
        </div>

        <aside className="sidebar">
          <div className="voice-card">
            <VoiceButton
              state={voiceState}
              onToggle={toggleVoice}
              interimText={interimText}
              finalText={finalText}
              supported={speechService.supported}
            />
            {feedback && (
              <div className={`feedback ${feedback.startsWith('✓') ? 'success' : 'error'}`}>
                {feedback}
              </div>
            )}
          </div>

          <div className="history-panel">
            <div className="history-header">
              <span>指令历史</span>
              <span className="history-count">{commands.length} 条</span>
            </div>
            <div className="history-list">
              {commands.length === 0 ? (
                <div className="history-empty">暂无指令记录</div>
              ) : (
                commands.map((cmd) => (
                  <div key={cmd.id} className="history-item">
                    <div className="hi-row">
                      <span className="hi-icon">{cmd.success ? '✅' : '❌'}</span>
                      <span className="hi-input">"{cmd.userInput}"</span>
                    </div>
                    <div className="hi-row" style={{ marginTop: 2 }}>
                      <span className="hi-arrow">→</span>
                      <span className="hi-result">{cmd.systemUnderstanding}</span>
                      <span className="hi-time">
                        {new Date(cmd.timestamp).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={historyEndRef} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
