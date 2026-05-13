import {
  AnnotationShapeType,
  LINE_ANNOTATION_SHAPE,
  RECTANGLE_ANNOTATION_SHAPE,
} from '@app/annotations/common/models/annotation-shape.model';

export interface Mode {
  name: string;
  cursor: string;
  stroke: number;
  shapeType?: AnnotationShapeType;
}

export const NormalMode: Mode = {
  name: 'normal',
  cursor: 'default',
  stroke: 0,
};

export const DrawingMode: Mode = {
  name: 'draw',
  cursor: 'crosshair',
  stroke: 3,
  shapeType: RECTANGLE_ANNOTATION_SHAPE,
};

export const LineDrawingMode: Mode = {
  name: 'draw-line',
  cursor: 'crosshair',
  stroke: 3,
  shapeType: LINE_ANNOTATION_SHAPE,
};

export const EditMode: Mode = {
  name: 'edit',
  cursor: 'pointer',
  stroke: 0,
};

export const CreationMode: Mode = {
  name: 'create',
  cursor: 'default',
  stroke: 0,
};

export const isDrawingMode = (mode?: Mode): boolean =>
  mode?.name === DrawingMode.name || mode?.name === LineDrawingMode.name;
