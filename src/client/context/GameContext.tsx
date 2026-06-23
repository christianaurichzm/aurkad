import { createContext, useContext, useState } from 'react';
import { MapMetaClient, Player } from '../../shared/types';

type GameContextType = {
  isLoggedIn: boolean;
  map: MapMetaClient | null;
  player: Player | null;
  loginSuccess: (data: { map: MapMetaClient; player: Player }) => void;
  setMap: (map: MapMetaClient) => void;
};

const GameContext = createContext<GameContextType | null>(null);

export const GameProvider = ({ children }: { children: React.ReactNode }) => {
  const [map, setMap] = useState<MapMetaClient | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const isLoggedIn = !!map && !!player;

  const loginSuccess = (data: { map: MapMetaClient; player: Player }) => {
    setMap(data.map);
    setPlayer(data.player);
  };

  return (
    <GameContext.Provider
      value={{ isLoggedIn, map, player, loginSuccess, setMap }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used within GameProvider');
  return context;
};
