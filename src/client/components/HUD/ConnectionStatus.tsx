import React from 'react';
import { useUIStore } from '../../stores/uiStore';
import { colors, radius, shadow, zIndex } from '../../theme';

export const ConnectionStatus: React.FC = () => {
  const connectionStatus = useUIStore((state) => state.connectionStatus);

  if (!connectionStatus.visible) return null;

  return (
    <div
      id="connection-status"
      style={{
        position: 'fixed',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 20px',
        background: connectionStatus.isError
          ? colors.dangerDark
          : colors.success,
        color: 'white',
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
