import React from 'react';
import { useUIStore } from '../../stores/uiStore';

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
        background: connectionStatus.isError ? '#c0392b' : '#27ae60',
        color: 'white',
        borderRadius: 4,
        fontWeight: 'bold',
        fontSize: 14,
        zIndex: 10000,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      {connectionStatus.message}
    </div>
  );
};
