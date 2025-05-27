import { createContext, useContext, useState } from 'react';
import { MapStateClient, Player } from '../../shared/types';

type GameContextType = {
  isLoggedIn: boolean;
  map: MapStateClient | null;
  player: Player | null;
  loginSuccess: (data: { map: MapStateClient; player: Player }) => void;
};

const GameContext = createContext<GameContextType | null>(null);

export const GameProvider = ({ children }: { children: React.ReactNode }) => {
  const [map, setMap] = useState<MapStateClient | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const isLoggedIn = !!map && !!player;

  const loginSuccess = (data: { map: MapStateClient; player: Player }) => {
    setMap(data.map);
    setPlayer(data.player);
  };

  return (
    <GameContext.Provider value={{ isLoggedIn, map, player, loginSuccess }}>
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used within GameProvider');
  return context;
};
