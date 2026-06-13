import { useState, useRef, useCallback, useEffect } from 'react';
import { CanvasPanel, type CanvasPanelRef } from './components/CanvasPanel';
import { VoiceButton } from './components/VoiceButton';
import { llmService, drawingTools } from './services/llm';
import { speechService } from './services/speech';
import { correctASRText, hasCorrections } from './services/textCorrection';
import type {
  VoiceState, CommandRecord, CreateShapeArgs, ModifyShapeArgs,
  DeleteShapeArgs, ConfirmAction,
} from './types/drawing';
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
逻辑坐标系为 800×600（x: 0-800, y: 0-600），左上角为原点，y 轴向下递增。
画布中心是 (400, 300)。左上角约 (100, 80)，右下角约 (700, 520)。

## 空间关系推理规则
当用户用相对位置描述时，根据参考对象的坐标计算目标位置：
- "在 X 右边" / "X 的右侧" → center_x = X.x + 160，center_y = X.y
- "在 X 左边" / "X 的左侧" → center_x = X.x - 160，center_y = X.y
- "在 X 上方" / "X 的上面" → center_x = X.x，center_y = X.y - 160
- "在 X 下方" / "X 的下面" → center_x = X.x，center_y = X.y + 160
- "在 X 旁边" / "X 附近" → center_x = X.x + 140，center_y = X.y
- "紧挨着 X" / "X 旁边近一点" → 使用偏移 ±90
- "在 X 远处" / "离 X 远一点" → 使用偏移 ±250
- "在 X 右上角" → center_x = X.x + 160，center_y = X.y - 120
- "在 X 左上角" → center_x = X.x - 160，center_y = X.y - 120
- "在 X 右下角" → center_x = X.x + 160，center_y = X.y + 120
- "在 X 左下角" → center_x = X.x - 160，center_y = X.y + 120
- "排成一排" → 水平等距排列，间距约 140，起始位置根据画布居中计算
- "排成一列" → 垂直等距排列，间距约 140
如果计算结果超出画布边界 (0-800 / 0-600)，请调整到边界内。

## 默认规则
- 未指定位置 → 画布中心 (400, 300)
- 未指定大小 → size=80（"大的"=120，"小的"=50）
- 未指定颜色 → #333333
- 修改/删除图形时，通过 target_id 引用画布状态中的对象
- 复合指令（"画一个圆和一个方形"）→ 返回多个工具调用
- 使用相对位置描述时，先查找参考对象坐标，再计算目标位置

## 删除规则
- 删除特定图形：使用 target_id 指定要删除的图形 ID
- 删除某类图形（如"删掉所有圆形"）：使用 filter_type 参数
- 删除特定颜色的某类图形（如"删掉红色的圆形"）：同时使用 filter_type 和 filter_color
- 用户说"删掉最后一个"：从画布状态中找最后一个对象的 ID，使用 target_id

## 查询规则
- "画布上有几个图形" → query_type: "count"
- "最大的图形是什么" → query_type: "largest"
- "最小的图形" → query_type: "smallest"
- "画布上有哪些颜色" → query_type: "colors"
- "有多少个圆形/矩形/..." → query_type: "by_type"，shape_type 指定类型

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
        const deleteArgs = args as DeleteShapeArgs;
        if (deleteArgs.target_id) {
          const ok = canvas.deleteShape(deleteArgs.target_id);
          results.push(ok ? `删除 ${deleteArgs.target_id}` : `未找到 ${deleteArgs.target_id}`);
        } else if (deleteArgs.filter_type || deleteArgs.filter_color || deleteArgs.all) {
          const state = canvas.getCanvasState();
          let targets = state;
          if (deleteArgs.filter_type) {
            targets = canvas.getShapesByType(deleteArgs.filter_type);
          }
          if (deleteArgs.filter_color) {
            const fc = deleteArgs.filter_color.toLowerCase();
            targets = targets.filter(
              (s) => s.color.toLowerCase().includes(fc) || s.color.toLowerCase() === fc,
            );
          }
          let count = 0;
          for (const s of targets) {
            if (canvas.deleteShape(s.id)) count++;
          }
          results.push(`删除了 ${count} 个图形`);
        }
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
          case 'largest': {
            const largest = canvas.getLargestShape();
            queryResult = largest
              ? `最大的图形是${largest.id}，类型为${largest.type}，颜色${largest.color}，尺寸${largest.size}`
              : '画布上没有图形';
            break;
          }
          case 'smallest': {
            const smallest = canvas.getSmallestShape();
            queryResult = smallest
              ? `最小的图形是${smallest.id}，类型为${smallest.type}，颜色${smallest.color}，尺寸${smallest.size}`
              : '画布上没有图形';
            break;
          }
          case 'colors': {
            const colors = [...new Set(state.map((o) => o.color))];
            queryResult = colors.length > 0
              ? `画布上的颜色有：${colors.join('、')}`
              : '画布上没有图形';
            break;
          }
          case 'by_type': {
            const targetType = args.shape_type;
            if (targetType) {
              const shapes = canvas.getShapesByType(targetType);
              queryResult = `画布上有 ${shapes.length} 个${targetType}`;
            } else {
              const typeCounts: Record<string, number> = {};
              state.forEach((s) => {
                typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
              });
              const parts = Object.entries(typeCounts).map(([t, c]) => `${t}: ${c}个`);
              queryResult = parts.length > 0
                ? `画布图形统计：${parts.join('，')}`
                : '画布上没有图形';
            }
            break;
          }
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
  const [confirmPending, setConfirmPending] = useState<ConfirmAction | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ============ TTS 语音播报 ============
  const speakText = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
  }, []);

  // ============ 确认机制 ============
  const enterConfirmation = useCallback((action: ConfirmAction) => {
    setConfirmPending(action);
    setVoiceState('confirming');
    speakText(`${action.details}，说确定来确认，或说取消来放弃`);

    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    confirmTimeoutRef.current = setTimeout(() => {
      setConfirmPending(null);
      setVoiceState('idle');
      setFeedback('已自动取消确认（15秒超时）');
      setTimeout(() => setFeedback(''), 3000);
    }, 15000);
  }, [speakText]);

  const handleConfirmation = useCallback((confirmed: boolean) => {
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }

    if (confirmed && confirmPending?.toolCalls && canvasRef.current) {
      setVoiceState('executing');
      executeToolCalls(canvasRef.current, confirmPending.toolCalls).then(
        ({ results, hasQuery, queryResult }) => {
          const summary = hasQuery ? queryResult! : results.join('; ');
          if (hasQuery && queryResult) speakText(queryResult);
          setFeedback(`✓ ${summary}`);
          addRecord(confirmPending.details, summary, true);
          setConfirmPending(null);
          setTimeout(() => setVoiceState('idle'), 2000);
        },
      );
    } else {
      setConfirmPending(null);
      setVoiceState('idle');
      setFeedback('已取消操作');
      setTimeout(() => setFeedback(''), 3000);
    }
  }, [confirmPending, speakText]);

  // ============ 判断是否为破坏性操作 ============
  function isDestructive(
    toolCalls: Array<{ function: { name: string; arguments: string } }>,
  ): { destructive: boolean; details: string } {
    for (const tc of toolCalls) {
      if (tc.function.name === 'clear_canvas') {
        return { destructive: true, details: '确定要清空画布吗？' };
      }
      if (tc.function.name === 'delete_shape') {
        try {
          const args = JSON.parse(tc.function.arguments) as DeleteShapeArgs;
          if (!args.target_id) {
            const parts: string[] = [];
            if (args.filter_color) parts.push(args.filter_color);
            if (args.filter_type) parts.push(args.filter_type);
            if (args.all) return { destructive: true, details: '确定要删除所有图形吗？' };
            const desc = parts.length > 0 ? parts.join('的') : '匹配的';
            return { destructive: true, details: `确定要删除${desc}图形吗？` };
          }
        } catch {
          // ignore
        }
      }
    }
    return { destructive: false, details: '' };
  }

  // ============ 从 tool calls 推导命令类型 ============
  function deriveCommandType(
    toolCalls: Array<{ function: { name: string } }>,
  ): string {
    if (toolCalls.length === 0) return 'unknown';
    if (toolCalls.length === 1) return toolCalls[0].function.name;
    const names = [...new Set(toolCalls.map((tc) => tc.function.name))];
    if (names.length === 1) return names[0];
    return 'composite';
  }

  // ============ 核心流程：语音文本 → 纠错 → LLM → 执行 ============
  const processVoiceCommand = useCallback(async (rawText: string) => {
    if (!rawText) {
      setVoiceState('idle');
      return;
    }

    // ====== 处理确认状态 ======
    if (confirmPending) {
      const t = rawText.toLowerCase();
      if (t.includes('确定') || t.includes('确认') || t.includes('好的') || t.includes('可以')) {
        handleConfirmation(true);
      } else if (t.includes('取消') || t.includes('算了') || t.includes('不要') || t.includes('放弃')) {
        handleConfirmation(false);
      } else {
        setFeedback('请说"确定"来确认操作，或说"取消"来放弃');
        speakText('请说确定或取消');
      }
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
      // Phase 2: 清空画布需要确认
      if (!confirmPending) {
        enterConfirmation({ type: 'clear_canvas', details: '确定要清空画布吗？' });
      }
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

      // Phase 2: 检查是否需要确认（破坏性操作）
      const { destructive, details } = isDestructive(toolCalls);
      if (destructive) {
        enterConfirmation({ type: 'delete_multiple', details, toolCalls });
        return;
      }

      // 执行工具调用
      setVoiceState('executing');
      if (canvasRef.current) {
        const { results, hasQuery, queryResult } = await executeToolCalls(canvasRef.current, toolCalls);
        const commandType = deriveCommandType(toolCalls);
        const summary = hasQuery ? queryResult! : results.join('; ');
        logInfo('执行结果', summary);

        // 查询结果语音播报
        if (hasQuery && queryResult) {
          speakText(queryResult);
        }

        setFeedback(`✓ ${summary}`);
        addRecord(correctedText, summary, true, commandType);
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
      speakText('操作失败，请稍后再试');
      addRecord(correctedText, `错误: ${msg.slice(0, 50)}`, false);
      setTimeout(() => setVoiceState('idle'), 3000);
    }
  }, [confirmPending, handleConfirmation, enterConfirmation, speakText]);

  function addRecord(input: string, understanding: string, success: boolean, commandType?: string) {
    const record: CommandRecord = {
      id: Date.now().toString(),
      userInput: input,
      systemUnderstanding: understanding,
      commandType: commandType || 'unknown',
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
              '在圆形右边画矩形',
              '画三个不同颜色的圆排成一排',
              '画一个房子',
              '画一朵花',
              '画一个太阳',
              '把圆形改成绿色',
              '删掉所有矩形',
              '最大的图形是什么',
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
            {confirmPending && (
              <div className="confirm-card">
                <div className="confirm-details">{confirmPending.details}</div>
                <div className="confirm-buttons">
                  <button className="confirm-yes" onClick={() => handleConfirmation(true)}>确定</button>
                  <button className="confirm-no" onClick={() => handleConfirmation(false)}>取消</button>
                </div>
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
                      <span className="hi-type-badge">{cmd.commandType}</span>
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
