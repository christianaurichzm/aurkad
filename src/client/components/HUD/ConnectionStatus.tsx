import React from 'react';
import { useUIStore } from '../../stores/uiStore';
import { colors, radius, shadow, zIndex } from '../../theme';

export const ConnectionStatus: React.FC = () => {
  const connectionStatus = useUIStore((state) => state.connectionStatus);

  if (!connectionStatus.visible) return null;

  return (
    <div
      id="connection-status"
      role="status"
      style={{
        position: 'absolute',
        top: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 20px',
        background: colors.surface,
        border: `1px solid ${connectionStatus.isError ? colors.danger : colors.border}`,
        color: connectionStatus.isError ? colors.dangerText : colors.success,
        borderRadius: radius.sm,
        fontWeight: 'bold',
        fontSize: 14,
        zIndex: zIndex.toast,
        boxShadow: shadow.raised,
      }}
    >
      {connectionStatus.message}
    </div>
  );
};
