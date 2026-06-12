import type { CommandRecord } from '@/types/drawing';

interface CommandHistoryProps {
  commands: CommandRecord[];
}

export function CommandHistory({ commands }: CommandHistoryProps) {
  if (commands.length === 0) return null;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 800,
        maxHeight: 200,
        overflowY: 'auto',
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.06)',
        background: 'white',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          fontSize: 13,
          fontWeight: 600,
          color: '#666',
          position: 'sticky',
          top: 0,
          background: 'white',
        }}
      >
        指令历史
      </div>
      {[...commands].reverse().map((cmd) => (
        <div
          key={cmd.id}
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid rgba(0,0,0,0.03)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 14,
          }}
        >
          <span style={{ fontSize: 16 }}>{cmd.success ? '✅' : '❌'}</span>
          <span style={{ color: '#333', fontWeight: 500 }}>"{cmd.userInput}"</span>
          <span style={{ color: '#aaa' }}>→</span>
          <span style={{ color: '#888' }}>{cmd.systemUnderstanding}</span>
          <span style={{ marginLeft: 'auto', color: '#bbb', fontSize: 12 }}>
            {new Date(cmd.timestamp).toLocaleTimeString('zh-CN')}
          </span>
        </div>
      ))}
    </div>
  );
}
