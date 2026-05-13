export const RECTANGLE_ANNOTATION_SHAPE = 'rectangle';
export const LINE_ANNOTATION_SHAPE = 'line';

export type SurgShapeType =
  | typeof RECTANGLE_ANNOTATION_SHAPE
  | typeof LINE_ANNOTATION_SHAPE;

export interface RectangleSurgPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineSurgPosition {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type SurgPosition = RectangleSurgPosition | LineSurgPosition;

export interface SurgShape {
  type?: SurgShapeType;
  positions: {
    [timestamp: number]: SurgPosition;
  };
}

export const getSurgShapeType = (shape?: SurgShape): SurgShapeType =>
  shape?.type === LINE_ANNOTATION_SHAPE
    ? LINE_ANNOTATION_SHAPE
    : RECTANGLE_ANNOTATION_SHAPE;

export const isLineSurgPosition = (
  position?: SurgPosition,
): position is LineSurgPosition =>
  !!position &&
  'x1' in position &&
  'y1' in position &&
  'x2' in position &&
  'y2' in position;
