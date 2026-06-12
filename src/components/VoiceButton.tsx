import type { VoiceState } from '@/types/drawing';

interface VoiceButtonProps {
  state: VoiceState;
  onToggle: () => void;
  interimText?: string;
  finalText?: string;
  supported: boolean;
}

export function VoiceButton({ state, onToggle, interimText, finalText, supported }: VoiceButtonProps) {
  const bgColor = {
    idle: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    listening: 'linear-gradient(135deg, #f44336 0%, #e91e63 100%)',
    processing: 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)',
    executing: 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)',
    error: 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)',
  }[state];

  const statusText = {
    idle: '点击开始说话',
    listening: '正在聆听...',
    processing: 'AI 理解中...',
    executing: '执行完成 ✓',
    error: '未识别，请重试',
  }[state];

  const icon = {
    idle: '🎤',
    listening: '🎤',
    processing: '⏳',
    executing: '✓',
    error: '✗',
  }[state];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
      <button
        onClick={onToggle}
        disabled={!supported || state === 'processing' || state === 'executing'}
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: bgColor,
          border: 'none',
          color: 'white',
          fontSize: 26,
          cursor: supported && state !== 'processing' && state !== 'executing' ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s ease',
          boxShadow:
            state === 'listening'
              ? '0 0 0 6px rgba(244,67,54,0.15), 0 4px 12px rgba(0,0,0,0.12)'
              : '0 4px 12px rgba(0,0,0,0.1)',
          animation: state === 'listening' ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      >
        {icon}
      </button>

      <span style={{ fontSize: 13, color: '#888', fontWeight: 500 }}>{statusText}</span>

      {(interimText || finalText) && (
        <div
          style={{
            padding: '8px 14px',
            background: 'rgba(0,0,0,0.03)',
            borderRadius: 10,
            fontSize: 14,
            color: finalText ? '#333' : '#999',
            maxWidth: 248,
            textAlign: 'center',
            minHeight: 20,
            wordBreak: 'break-all',
          }}
        >
          {finalText || interimText}
        </div>
      )}

      {!supported && (
        <div style={{ color: '#f44336', fontSize: 12, textAlign: 'center' }}>
          浏览器不支持语音，请使用 Chrome
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}
