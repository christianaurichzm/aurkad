import { TileEditMode } from '../../../shared/types';

export type ModeConfig = {
  button: HTMLButtonElement;
  textOn: string;
  textOff: string;
  styleOn: string;
  styleOff: string;
  place: (row: number, col: number) => void;
};

export type SelectedTile = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type TileEditorState = {
  selectedTile: SelectedTile;
  isSelecting: boolean;
  isPlacing: boolean;
  activeMode: TileEditMode | null;
  mapWidth: number;
  mapHeight: number;
  map: any[][];
  originalMap: any[][];
  mapEdited: boolean;
  hoveredCell: { row: number; col: number } | null;
};
