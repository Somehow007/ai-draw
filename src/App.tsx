import { useState, useRef, useCallback, useEffect } from 'react';
import { CanvasPanel, type CanvasPanelRef } from './components/CanvasPanel';
import { VoiceButton } from './components/VoiceButton';
import { llmService, drawingTools } from './services/llm';
import { speechService } from './services/speech';
import type { VoiceState, CommandRecord, CreateShapeArgs, ModifyShapeArgs } from './types/drawing';
import './App.css';

// ============ System Prompt ============
const SYSTEM_PROMPT = `你是一个语音绘图助手。用户通过语音向你发出绘图指令，你需要通过工具调用来在画布上执行操作。

画布逻辑坐标系为 800×600（x: 0-800, y: 0-800）。

关键规则：
- 创建图形时，如果用户没有指定位置，默认放在画布中心 (400, 300)
- 创建图形时，如果用户没有指定大小，默认 size=80
- 创建图形时，如果用户没有指定颜色，默认使用 #333333
- 修改/删除图形时，通过 target_id 引用画布状态中的对象
- 如果用户的描述模糊（如同音字错误），请根据上下文理解正确意图
- 对于复合指令（如"画一个圆和一个方形"），返回多个工具调用
- "大的"对应 size=120，"小的"对应 size=50，普通大小对应 size=80`;

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

  // 核心流程：语音文本 → LLM → 执行
  const processVoiceCommand = useCallback(async (text: string) => {
    if (!text) {
      setVoiceState('idle');
      return;
    }

    // L0: 快速指令（不走 LLM）
    const t = text.toLowerCase();
    if (t.includes('清空') || t.includes('清除')) {
      canvasRef.current?.clearCanvas();
      setVoiceState('executing');
      setFeedback('✓ 清空画布');
      addRecord(text, '清空画布', true);
      setTimeout(() => setVoiceState('idle'), 1500);
      return;
    }
    if (t.includes('撤销') || t.includes('回退')) {
      canvasRef.current?.undo();
      setVoiceState('executing');
      setFeedback('✓ 撤销上一步');
      addRecord(text, '撤销上一步', true);
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

      const messages = [
        { role: 'system' as const, content: `${SYSTEM_PROMPT}\n\n当前画布对象:\n${stateDesc}` },
        { role: 'user' as const, content: text },
      ];

      const { provider, response } = await llmService.callWithFailover(messages, drawingTools);
      setLlmProvider(provider);

      const toolCalls = response.choices?.[0]?.message?.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        const content = response.choices?.[0]?.message?.content;
        setVoiceState('error');
        setFeedback(content ? `AI: ${content}` : '未理解该指令，请换种方式描述');
        addRecord(text, content || '无法理解', false);
        setTimeout(() => setVoiceState('idle'), 2000);
        return;
      }

      // 执行工具调用
      setVoiceState('executing');
      if (canvasRef.current) {
        const { results, hasQuery, queryResult } = await executeToolCalls(canvasRef.current, toolCalls);
        const summary = hasQuery ? queryResult! : results.join('; ');
        setFeedback(`✓ ${summary}`);
        addRecord(text, summary, true);
      }

      setTimeout(() => setVoiceState('idle'), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setVoiceState('error');
      setFeedback(`错误: ${msg.slice(0, 100)}`);
      addRecord(text, `错误: ${msg.slice(0, 50)}`, false);
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
              '画蓝色矩形在右上角',
              '把圆形改成绿色',
              '画三个不同颜色的圆',
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
