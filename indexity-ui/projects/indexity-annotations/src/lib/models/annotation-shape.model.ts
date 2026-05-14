export const RECTANGLE_ANNOTATION_SHAPE = 'rectangle';
export const LINE_ANNOTATION_SHAPE = 'line';

export type AnnotationShapeType =
  | typeof RECTANGLE_ANNOTATION_SHAPE
  | typeof LINE_ANNOTATION_SHAPE;

export interface RectangleAnnotationPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineAnnotationPosition {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type AnnotationPosition =
  | RectangleAnnotationPosition
  | LineAnnotationPosition;

export interface AnnotationShape {
  type?: AnnotationShapeType;
  positions: {
    [timestamp: number]: AnnotationPosition;
  };
}

export const getAnnotationShapeType = (
  shape?: AnnotationShape,
): AnnotationShapeType =>
  shape?.type === LINE_ANNOTATION_SHAPE
    ? LINE_ANNOTATION_SHAPE
    : RECTANGLE_ANNOTATION_SHAPE;

export const isLineAnnotationPosition = (
  position?: AnnotationPosition,
): position is LineAnnotationPosition =>
  !!position &&
  'x1' in position &&
  'y1' in position &&
  'x2' in position &&
  'y2' in position;

export const isLineAnnotationShape = (shape?: AnnotationShape): boolean =>
  getAnnotationShapeType(shape) === LINE_ANNOTATION_SHAPE;
