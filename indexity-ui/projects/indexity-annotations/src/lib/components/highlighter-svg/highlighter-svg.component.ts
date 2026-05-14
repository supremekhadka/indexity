import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { cloneDeep, clamp } from 'lodash';
import {
  DrawingMode,
  EditMode,
  isDrawingMode,
  LineDrawingMode,
  Mode,
  NormalMode,
} from '../../models/mode';
import * as annotationsHelper from '../../helpers/annotations.helper';
import { SvgAnnotationFormDialogComponent } from '../svg-annotation-form-dialog/svg-annotation-form-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { AnnotationLabel } from '../../models/annotation-label.model';
import { Annotation } from '../../models/annotation.model';
import {
  AnnotationPosition,
  AnnotationShape,
  AnnotationShapeType,
  getAnnotationShapeType,
  isLineAnnotationPosition,
  isLineAnnotationShape,
  LINE_ANNOTATION_SHAPE,
  RECTANGLE_ANNOTATION_SHAPE,
} from '../../models/annotation-shape.model';
import { BehaviorSubject } from 'rxjs';
import { AnnotationLabelGroup } from '@app/annotations/models/annotation-label-group.model';

interface DrawnShape {
  type: AnnotationShapeType;
  width: number;
  height: number;
  posX: number;
  posY: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  name: string;
}

@Component({
  selector: 'surg-highlighter-svg',
  templateUrl: './highlighter-svg.component.html',
  styles: [
    `
      svg {
        position: fixed;
        z-index: 100;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HighlighterSvgComponent implements OnChanges {
  @Input() activateLabels = true;
  @Input() currentMode: Mode = NormalMode;
  @Input() hovered: number = null;
  @Input() svgOverlay = { top: 0, left: 0, width: 0, height: 0 };
  @Input() shape: AnnotationShape = { positions: {} };
  @Input() currentTime = 0;
  @Input() videoDuration = 0;
  @Input() videoId = null;
  @Input() hiddenAnnotations: number[] = [];
  @Input() displayedShapes: Array<Annotation> = [];
  @Input() tmpSvgAnnotation: Annotation;
  @Input() annotationToUpdate: Annotation;
  @Input() labels: Array<AnnotationLabel> = [];
  @Input() showLabels = true;
  @Input() labelDeletion = false;
  @Input() suggestedLabelGroup: AnnotationLabelGroup;

  @Output() setShape = new EventEmitter<AnnotationShape>();
  @Output() setTmp = new EventEmitter<Annotation>();
  @Output() setMode = new EventEmitter<Mode>();
  @Output() update = new EventEmitter<Partial<Annotation>>();
  @Output() seekForward = new EventEmitter<void>();
  @Output() seekBackward = new EventEmitter<void>();
  @Output() searchQuery = new EventEmitter<string>();
  @Output() hover = new EventEmitter<number>();
  @Output() deleteAnnotationLabel = new EventEmitter<string>();
  @Output() isDialogOpen = new EventEmitter<boolean>();

  firstMousePositionX: number;
  firstMousePositionY: number;
  initialDrawnShape: DrawnShape | null = null;

  rectangleMoving = false;
  rectangleDrawing = false;
  svgLeave = false;
  cursor = 'default';
  dragHandle: 'start' | 'end' | null = null;

  initShape = {
    type: RECTANGLE_ANNOTATION_SHAPE as AnnotationShapeType,
    width: 0,
    height: 0,
    posX: 0,
    posY: 0,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    color: '#b31111',
    name: '',
  };
  drawnShape: DrawnShape = { ...this.initShape };
  lastAnnotation: Annotation;
  structureDisplayedShapes: Array<Annotation> = [];
  searchResults$ = new BehaviorSubject<AnnotationLabel[]>([]);
  annotationsTrackBy = (index, annotation): any => annotation.id;

  constructor(public dialog: MatDialog) {}

  get drawingShapeType(): AnnotationShapeType {
    if (isDrawingMode(this.currentMode) && this.currentMode.shapeType) {
      return this.currentMode.shapeType;
    }
    if (this.tmpSvgAnnotation?.shape) {
      return getAnnotationShapeType(this.tmpSvgAnnotation.shape);
    }
    return getAnnotationShapeType(this.shape);
  }

  isLineShape(shape?: AnnotationShape): boolean {
    return isLineAnnotationShape(shape);
  }
  isLineDrawing(): boolean {
    return this.drawnShape.type === LINE_ANNOTATION_SHAPE;
  }
  isLineAnnotation(annotation: Annotation): boolean {
    return isLineAnnotationShape(annotation?.shape);
  }

  getLabelX(annotation: Annotation): number {
    const position = this.getPositionAtCurrentTime(annotation.shape);
    return isLineAnnotationPosition(position)
      ? Math.min(position.x1, position.x2) + 10
      : position.x + 10;
  }

  getLabelY(annotation: Annotation): number {
    const position = this.getPositionAtCurrentTime(annotation.shape);
    return isLineAnnotationPosition(position)
      ? Math.min(position.y1, position.y2) + 20
      : position.y + 20;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      (changes.currentTime || changes.tmpSvgAnnotation) &&
      this.tmpSvgAnnotation &&
      this.currentMode === EditMode
    ) {
      if (!annotationsHelper.isAt(this.currentTime)(this.tmpSvgAnnotation)) {
        const annotation = this.displayedShapes.find(
          (a) => a.id === this.tmpSvgAnnotation.id,
        );
        if (annotation) {
          this.update.emit(annotation);
        }
      } else if (!this.rectangleMoving) {
        this.setDrawnShapePositionAtCurrentTime();
      }
    } else if (
      changes.tmpSvgAnnotation &&
      isDrawingMode(this.currentMode) &&
      this.tmpSvgAnnotation
    ) {
      this.setDrawnShapePositionAtCurrentTime();
    }

    if (changes.annotationToUpdate && this.annotationToUpdate) {
      this.setShape.emit(this.annotationToUpdate.shape);
      this.setTmp.emit(this.annotationToUpdate);
      this.drawnShape = {
        ...this.drawnShape,
        type: getAnnotationShapeType(this.annotationToUpdate.shape),
        color: this.annotationToUpdate.label?.color || this.drawnShape.color,
        name: this.annotationToUpdate.label?.name || this.drawnShape.name,
      };
    }

    if (
      changes.currentMode &&
      changes.currentMode.currentValue !== changes.currentMode.previousValue
    ) {
      this.cursor = this.currentMode.cursor;
      this.dragHandle = null;
      if (changes.currentMode.previousValue !== NormalMode) {
        this.initialDrawnShape = null;
        this.drawnShape = { ...this.initShape };
        this.setShape.emit();
        this.setTmp.emit();
      }
    }

    if (
      changes.svgOverlay &&
      changes.svgOverlay.previousValue !== changes.svgOverlay.currentValue
    ) {
      this.resizeShape();
    }

    if (changes.displayedShapes && this.displayedShapes) {
      this.structureDisplayedShapes = this.displayedShapes.filter(
        (a) => a.label.type === 'structure',
      );
    }

    if (changes.labels && this.labels) {
      this.searchResults$.next(changes.labels.currentValue);
    }

    if (changes.shape && (!this.shape || !this.shape.positions)) {
      this.shape = { type: this.drawingShapeType, positions: {} };
    }
  }

  isDrawnShapeVisible(): boolean {
    if (isDrawingMode(this.currentMode)) {
      return true;
    }
    if (this.currentMode === EditMode && this.tmpSvgAnnotation) {
      return annotationsHelper.isAt(this.currentTime)(this.tmpSvgAnnotation);
    }
    return false;
  }

  @HostListener('mouseleave')
  onMouseLeave(): boolean {
    if (this.rectangleDrawing) {
      this.svgLeave = true;
      this.onMouseUp();
    }
    return false;
  }

  setDrawnShapePositionAtCurrentTime(): void {
    const annotationWithCurrentChanges = cloneDeep(this.tmpSvgAnnotation);
    annotationWithCurrentChanges.shape.positions = {
      ...annotationWithCurrentChanges.shape.positions,
      ...this.shape.positions,
    };
    this.drawnShape = this.buildDrawnShapeFromPosition(
      this.getPositionAtCurrentTime(annotationWithCurrentChanges.shape),
      getAnnotationShapeType(annotationWithCurrentChanges.shape),
    );
  }

  toLineDrawnShape(x1: number, y1: number, x2: number, y2: number): DrawnShape {
    return {
      ...this.drawnShape,
      type: LINE_ANNOTATION_SHAPE,
      x1,
      y1,
      x2,
      y2,
      posX: Math.min(x1, x2),
      posY: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  buildDrawnShapeFromPosition(
    position: AnnotationPosition,
    shapeType: AnnotationShapeType,
  ): DrawnShape {
    if (isLineAnnotationPosition(position)) {
      return {
        ...this.drawnShape,
        type: LINE_ANNOTATION_SHAPE,
        height: Math.abs(position.y2 - position.y1),
        width: Math.abs(position.x2 - position.x1),
        posX: Math.min(position.x1, position.x2),
        posY: Math.min(position.y1, position.y2),
        x1: position.x1,
        y1: position.y1,
        x2: position.x2,
        y2: position.y2,
      };
    }
    return {
      ...this.drawnShape,
      type: shapeType,
      height: position.height,
      width: position.width,
      posX: position.x,
      posY: position.y,
      x1: position.x,
      y1: position.y,
      x2: position.x + position.width,
      y2: position.y + position.height,
    };
  }

  @HostListener('mouseenter')
  onMouseEnter(): boolean {
    if (this.rectangleDrawing) {
      this.svgLeave = false;
    }
    return false;
  }

  @HostListener('mousedown', ['$event'])
  @HostListener('touchstart', ['$event'])
  onMousedown(event): boolean {
    const x = event.touches
      ? event.touches[0].clientX - this.svgOverlay.left
      : event.clientX - this.svgOverlay.left;
    const y = event.touches
      ? event.touches[0].clientY - this.svgOverlay.top
      : event.clientY - this.svgOverlay.top;

    if (!this.rectangleDrawing && this.tmpSvgAnnotation) {
      this.initialDrawnShape = cloneDeep(this.drawnShape);
      this.rectangleMoving = true;
      if (this.isLineDrawing()) {
        this.firstMousePositionX = x;
        this.firstMousePositionY = y;
      } else {
        this.firstMousePositionX = x - this.drawnShape.posX;
        this.firstMousePositionY = y - this.drawnShape.posY;
      }
    } else if (
      isDrawingMode(this.currentMode) &&
      (event.button === 0 || event.touches)
    ) {
      this.rectangleDrawing = true;
      this.dragHandle = null;
      this.drawnShape = {
        ...this.drawnShape,
        type: this.drawingShapeType,
        posX: x,
        posY: y,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        width: 0,
        height: 0,
      };
      this.firstMousePositionX = x;
      this.firstMousePositionY = y;
    }
    return false;
  }

  @HostListener('mousemove', ['$event'])
  @HostListener('touchmove', ['$event'])
  onMouseMove(event): boolean {
    const x = event.touches
      ? event.touches[0].clientX - this.svgOverlay.left
      : event.clientX - this.svgOverlay.left;
    const y = event.touches
      ? event.touches[0].clientY - this.svgOverlay.top
      : event.clientY - this.svgOverlay.top;

    if (this.svgLeave) {
      return false;
    }

    let posX = 0;
    let posY = 0;

    if (this.rectangleDrawing) {
      if (this.drawingShapeType === LINE_ANNOTATION_SHAPE) {
        this.drawnShape = this.toLineDrawnShape(
          this.firstMousePositionX,
          this.firstMousePositionY,
          x,
          y,
        );
      } else {
        if (this.firstMousePositionX <= x && this.firstMousePositionY <= y) {
          posY = this.firstMousePositionY;
          posX = this.firstMousePositionX;
        } else if (
          this.firstMousePositionX <= x &&
          this.firstMousePositionY > y
        ) {
          posY = y;
          posX = this.firstMousePositionX;
        } else if (
          this.firstMousePositionX > x &&
          this.firstMousePositionY <= y
        ) {
          posX = x;
          posY = this.firstMousePositionY;
        } else {
          posY = y;
          posX = x;
        }
        this.drawnShape = {
          ...this.drawnShape,
          type: RECTANGLE_ANNOTATION_SHAPE,
          posX,
          posY,
          width: Math.abs(this.firstMousePositionX - x),
          height: Math.abs(this.firstMousePositionY - y),
          x1: posX,
          y1: posY,
          x2: posX + Math.abs(this.firstMousePositionX - x),
          y2: posY + Math.abs(this.firstMousePositionY - y),
        };
      }
    } else if (this.rectangleMoving) {
      this.updateDrawnShape(x, y, event.touches);
      this.updatePositions();
    } else {
      this.cursor = this.getCursor(x, y);
    }
    return false;
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event): void {
    if (
      event.ctrlKey &&
      (isDrawingMode(this.currentMode) || this.currentMode === EditMode) &&
      this.tmpSvgAnnotation
    ) {
      this.cursor = 'move';
      if (event.key === 'ArrowLeft') {
        this.moveLeft();
      } else if (event.key === 'ArrowUp') {
        this.moveUp();
      } else if (event.key === 'ArrowRight') {
        this.moveRight();
      } else if (event.key === 'ArrowDown') {
        this.moveDown();
      }
    } else if (event.key === 'ArrowLeft') {
      this.seekBackward.emit();
    } else if (event.key === 'ArrowRight') {
      this.seekForward.emit();
    }

    if (event.altKey && event.code === 'KeyJ' && this.lastAnnotation) {
      this.setMode.emit(
        this.isLineShape(this.lastAnnotation.shape)
          ? LineDrawingMode
          : DrawingMode,
      );
      const lastPositionTimestamp = Object.keys(
        this.lastAnnotation.shape.positions,
      )
        .sort((a, b) => (+a > +b ? 1 : +a < +b ? -1 : 0))
        .pop();
      const newShape = { ...this.lastAnnotation.shape, positions: {} };
      newShape.positions[this.currentTime] =
        this.lastAnnotation.shape.positions[lastPositionTimestamp];
      this.createAnnotation(newShape, this.lastAnnotation.label);
    }
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(event): void {
    if (
      (isDrawingMode(this.currentMode) || this.currentMode === EditMode) &&
      this.tmpSvgAnnotation
    ) {
      if (event.ctrlKey && event.key.startsWith('Arrow')) {
        this.updatePositions();
        this.cursor = 'default';
      }
    }
  }

  updatePositions(): void {
    const positions = { ...this.shape.positions };
    const currentPos = this.getPositionAtCurrentTime(this.shape);
    const currentPositionChanged = isLineAnnotationPosition(currentPos)
      ? currentPos.x1 !== this.drawnShape.x1 ||
        currentPos.y1 !== this.drawnShape.y1 ||
        currentPos.x2 !== this.drawnShape.x2 ||
        currentPos.y2 !== this.drawnShape.y2
      : currentPos.x !== this.drawnShape.posX ||
        currentPos.y !== this.drawnShape.posY ||
        currentPos.width !== this.drawnShape.width ||
        currentPos.height !== this.drawnShape.height;

    if (currentPositionChanged) {
      positions[this.currentTime] = this.isLineDrawing()
        ? {
            x1: annotationsHelper.getWidthInRatio(
              this.drawnShape.x1,
              this.svgOverlay.width,
            ),
            y1: annotationsHelper.getHeightInRatio(
              this.drawnShape.y1,
              this.svgOverlay.height,
            ),
            x2: annotationsHelper.getWidthInRatio(
              this.drawnShape.x2,
              this.svgOverlay.width,
            ),
            y2: annotationsHelper.getHeightInRatio(
              this.drawnShape.y2,
              this.svgOverlay.height,
            ),
          }
        : {
            x: annotationsHelper.getWidthInRatio(
              this.drawnShape.posX,
              this.svgOverlay.width,
            ),
            y: annotationsHelper.getHeightInRatio(
              this.drawnShape.posY,
              this.svgOverlay.height,
            ),
            width: annotationsHelper.getWidthInRatio(
              this.drawnShape.width,
              this.svgOverlay.width,
            ),
            height: annotationsHelper.getHeightInRatio(
              this.drawnShape.height,
              this.svgOverlay.height,
            ),
          };

      const shape: AnnotationShape = {
        ...this.shape,
        type: this.isLineDrawing()
          ? LINE_ANNOTATION_SHAPE
          : RECTANGLE_ANNOTATION_SHAPE,
        positions,
      };
      this.setShape.emit(shape);
      if (this.tmpSvgAnnotation) {
        if (this.tmpSvgAnnotation.isOneShot) {
          shape.positions = {};
          shape.positions[this.tmpSvgAnnotation.timestamp] =
            positions[this.currentTime];
          this.setShape.emit(shape);
        }
        const annotation: Annotation = {
          ...this.tmpSvgAnnotation,
          shape: { ...shape },
        };
        if (isDrawingMode(this.currentMode)) {
          this.lastAnnotation = annotation;
        }
      }
    }
  }

  moveLeft(): void {
    this.drawnShape = this.isLineDrawing()
      ? this.toLineDrawnShape(
          this.drawnShape.x1 - 1,
          this.drawnShape.y1,
          this.drawnShape.x2 - 1,
          this.drawnShape.y2,
        )
      : {
          ...this.drawnShape,
          posX: this.drawnShape.posX - 1,
          x1: this.drawnShape.x1 - 1,
          x2: this.drawnShape.x2 - 1,
        };
  }
  moveRight(): void {
    this.drawnShape = this.isLineDrawing()
      ? this.toLineDrawnShape(
          this.drawnShape.x1 + 1,
          this.drawnShape.y1,
          this.drawnShape.x2 + 1,
          this.drawnShape.y2,
        )
      : {
          ...this.drawnShape,
          posX: this.drawnShape.posX + 1,
          x1: this.drawnShape.x1 + 1,
          x2: this.drawnShape.x2 + 1,
        };
  }
  moveUp(): void {
    this.drawnShape = this.isLineDrawing()
      ? this.toLineDrawnShape(
          this.drawnShape.x1,
          this.drawnShape.y1 - 1,
          this.drawnShape.x2,
          this.drawnShape.y2 - 1,
        )
      : {
          ...this.drawnShape,
          posY: this.drawnShape.posY - 1,
          y1: this.drawnShape.y1 - 1,
          y2: this.drawnShape.y2 - 1,
        };
  }
  moveDown(): void {
    this.drawnShape = this.isLineDrawing()
      ? this.toLineDrawnShape(
          this.drawnShape.x1,
          this.drawnShape.y1 + 1,
          this.drawnShape.x2,
          this.drawnShape.y2 + 1,
        )
      : {
          ...this.drawnShape,
          posY: this.drawnShape.posY + 1,
          y1: this.drawnShape.y1 + 1,
          y2: this.drawnShape.y2 + 1,
        };
  }

  updateDrawnShape(offsetX: number, offsetY: number, touchEvent = false): void {
    if (this.isLineDrawing()) {
      if (!this.initialDrawnShape) {
        return;
      }
      const initialShape = this.initialDrawnShape;
      if (this.dragHandle === 'start') {
        this.drawnShape = this.toLineDrawnShape(
          clamp(offsetX, 0, this.svgOverlay.width),
          clamp(offsetY, 0, this.svgOverlay.height),
          initialShape.x2,
          initialShape.y2,
        );
      } else if (this.dragHandle === 'end') {
        this.drawnShape = this.toLineDrawnShape(
          initialShape.x1,
          initialShape.y1,
          clamp(offsetX, 0, this.svgOverlay.width),
          clamp(offsetY, 0, this.svgOverlay.height),
        );
      } else if (this.cursor === 'move' || touchEvent) {
        const deltaX = offsetX - this.firstMousePositionX;
        const deltaY = offsetY - this.firstMousePositionY;
        const clampedDeltaX = clamp(
          deltaX,
          -Math.min(initialShape.x1, initialShape.x2),
          this.svgOverlay.width - Math.max(initialShape.x1, initialShape.x2),
        );
        const clampedDeltaY = clamp(
          deltaY,
          -Math.min(initialShape.y1, initialShape.y2),
          this.svgOverlay.height - Math.max(initialShape.y1, initialShape.y2),
        );
        this.drawnShape = this.toLineDrawnShape(
          initialShape.x1 + clampedDeltaX,
          initialShape.y1 + clampedDeltaY,
          initialShape.x2 + clampedDeltaX,
          initialShape.y2 + clampedDeltaY,
        );
      }
      return;
    }

    const minWidthAndHeight = 20;
    const x = offsetX - this.firstMousePositionX;
    const y = offsetY - this.firstMousePositionY;

    if (this.cursor === 'move' || touchEvent) {
      this.drawnShape = {
        ...this.drawnShape,
        posX: clamp(x, 0, this.svgOverlay.width - this.drawnShape.width),
        posY: clamp(y, 0, this.svgOverlay.height - this.drawnShape.height),
      };
    } else if (this.cursor === 'n-resize') {
      const newHeight =
        this.drawnShape.height + (this.drawnShape.posY - offsetY);
      if (newHeight >= minWidthAndHeight) {
        this.drawnShape = {
          ...this.drawnShape,
          posY: offsetY,
          height: newHeight,
        };
      }
    } else if (this.cursor === 's-resize') {
      const newHeight = offsetY - this.drawnShape.posY;
      if (newHeight >= minWidthAndHeight) {
        this.drawnShape = { ...this.drawnShape, height: newHeight };
      }
    } else if (this.cursor === 'e-resize') {
      const newWidth = offsetX - this.drawnShape.posX;
      if (newWidth >= minWidthAndHeight) {
        this.drawnShape = { ...this.drawnShape, width: newWidth };
      }
    } else if (this.cursor === 'w-resize') {
      const newWidth = this.drawnShape.width + (this.drawnShape.posX - offsetX);
      if (newWidth >= minWidthAndHeight) {
        this.drawnShape = {
          ...this.drawnShape,
          posX: offsetX,
          width: newWidth,
        };
      }
    } else if (this.cursor === 'nw-resize') {
      if (offsetX > this.drawnShape.posX && offsetY > this.drawnShape.posY) {
        const newWidth =
          this.drawnShape.width - (offsetX - this.drawnShape.posX);
        const newHeight =
          this.drawnShape.height - (offsetY - this.drawnShape.posY);
        if (newWidth >= minWidthAndHeight && newHeight >= minWidthAndHeight) {
          this.drawnShape = {
            ...this.drawnShape,
            posX: offsetX,
            posY: offsetY,
            width: newWidth,
            height: newHeight,
          };
        }
      } else {
        const newWidth =
          this.drawnShape.width + (this.drawnShape.posX - offsetX);
        const newHeight =
          this.drawnShape.height + (this.drawnShape.posY - offsetY);
        if (newWidth >= minWidthAndHeight && newHeight >= minWidthAndHeight) {
          this.drawnShape = {
            ...this.drawnShape,
            posX: offsetX,
            posY: offsetY,
            width: newWidth,
            height: newHeight,
          };
        }
      }
    } else if (this.cursor === 'ne-resize') {
      if (
        offsetX < this.drawnShape.posX + this.drawnShape.width &&
        offsetY < this.drawnShape.posY + this.drawnShape.height
      ) {
        const newWidth = offsetX - this.drawnShape.posX;
        const newHeight =
          this.drawnShape.height - (offsetY - this.drawnShape.posY);
        if (newWidth >= minWidthAndHeight && newHeight >= minWidthAndHeight) {
          this.drawnShape = {
            ...this.drawnShape,
            posY: offsetY,
            width: newWidth,
            height: newHeight,
          };
        }
      } else {
        const newWidth = offsetX - this.drawnShape.posX;
        const newHeight =
          this.drawnShape.height + (this.drawnShape.posY - offsetY);
        if (newWidth >= minWidthAndHeight && newHeight >= minWidthAndHeight) {
          this.drawnShape = {
            ...this.drawnShape,
            posY: offsetY,
            width: newWidth,
            height: newHeight,
          };
        }
      }
    } else if (this.cursor === 'sw-resize') {
      if (
        offsetX < this.drawnShape.posX &&
        offsetY > this.drawnShape.posY + this.drawnShape.height
      ) {
        const newWidth =
          this.drawnShape.width - (offsetX - this.drawnShape.posX);
        const newHeight = offsetY - this.drawnShape.posY;
        if (newWidth >= minWidthAndHeight && newHeight >= minWidthAndHeight) {
          this.drawnShape = {
            ...this.drawnShape,
            posX: offsetX,
            height: newHeight,
            width: newWidth,
          };
        }
      } else {
        const newWidth =
          this.drawnShape.width + (this.drawnShape.posX - offsetX);
        const newHeight = offsetY - this.drawnShape.posY;
        if (newWidth >= minWidthAndHeight && newHeight >= minWidthAndHeight) {
          this.drawnShape = {
            ...this.drawnShape,
            posX: offsetX,
            height: newHeight,
            width: newWidth,
          };
        }
      }
    } else if (this.cursor === 'se-resize') {
      const newWidth = offsetX - this.drawnShape.posX;
      const newHeight = offsetY - this.drawnShape.posY;
      if (newWidth >= minWidthAndHeight && newHeight >= minWidthAndHeight) {
        this.drawnShape = {
          ...this.drawnShape,
          width: newWidth,
          height: newHeight,
        };
      }
    }

    this.drawnShape = {
      ...this.drawnShape,
      type: RECTANGLE_ANNOTATION_SHAPE,
      x1: this.drawnShape.posX,
      y1: this.drawnShape.posY,
      x2: this.drawnShape.posX + this.drawnShape.width,
      y2: this.drawnShape.posY + this.drawnShape.height,
    };
  }

  @HostListener('mouseup')
  @HostListener('touchend')
  onMouseUp(): boolean {
    this.rectangleMoving = false;
    this.dragHandle = null;

    const positions = { ...this.shape.positions };
    positions[this.currentTime] = this.isLineDrawing()
      ? {
          x1: annotationsHelper.getWidthInRatio(
            this.drawnShape.x1,
            this.svgOverlay.width,
          ),
          y1: annotationsHelper.getHeightInRatio(
            this.drawnShape.y1,
            this.svgOverlay.height,
          ),
          x2: annotationsHelper.getWidthInRatio(
            this.drawnShape.x2,
            this.svgOverlay.width,
          ),
          y2: annotationsHelper.getHeightInRatio(
            this.drawnShape.y2,
            this.svgOverlay.height,
          ),
        }
      : {
          x: annotationsHelper.getWidthInRatio(
            this.drawnShape.posX,
            this.svgOverlay.width,
          ),
          y: annotationsHelper.getHeightInRatio(
            this.drawnShape.posY,
            this.svgOverlay.height,
          ),
          width: annotationsHelper.getWidthInRatio(
            this.drawnShape.width,
            this.svgOverlay.width,
          ),
          height: annotationsHelper.getHeightInRatio(
            this.drawnShape.height,
            this.svgOverlay.height,
          ),
        };

    if (isDrawingMode(this.currentMode) && this.rectangleDrawing) {
      const shape: AnnotationShape = {
        ...this.shape,
        type: this.drawingShapeType,
        positions,
      };
      if (this.activateLabels) {
        const dialogRef = this.dialog.open(SvgAnnotationFormDialogComponent, {
          width: '600px',
          data: {
            enableDelete: this.labelDeletion,
            labels$: this.searchResults$,
            suggestedLabelGroup: this.suggestedLabelGroup,
            allowedLabelTypes: ['structure'],
            deleteLabelHandler: (name) => this.deleteAnnotationLabel.emit(name),
          },
          disableClose: false,
        });
        let queryChangesSub;
        dialogRef.afterOpened().subscribe(() => {
          this.isDialogOpen.emit(true);
          queryChangesSub = dialogRef.componentInstance.queryChanges$.subscribe(
            this.searchQuery,
          );
        });
        dialogRef.afterClosed().subscribe((data) => {
          this.isDialogOpen.emit(false);
          queryChangesSub.unsubscribe();
          if (data && data.name) {
            this.createAnnotation(shape, data);
          } else {
            this.drawnShape = { ...this.initShape };
            this.setMode.emit(NormalMode);
          }
        });
      } else {
        this.createAnnotation(shape, {
          name: '',
          color: '#b31111',
          type: 'structure',
        });
      }
    }

    this.rectangleDrawing = false;
    this.svgLeave = false;
    this.initialDrawnShape = null;
    return false;
  }

  onAnnotationDblClick(annotation: Annotation): void {
    const dialogRef = this.dialog.open(SvgAnnotationFormDialogComponent, {
      width: '600px',
      data: {
        enableDelete: this.labelDeletion,
        labels$: this.searchResults$,
        allowedLabelTypes: ['structure'],
        suggestedLabelGroup: this.suggestedLabelGroup,
        currentLabel: { ...annotation.label },
        deleteLabelHandler: (name) => this.deleteAnnotationLabel.emit(name),
      },
      disableClose: false,
    });
    let queryChangesSub;
    dialogRef.afterOpened().subscribe(() => {
      this.isDialogOpen.emit(true);
      queryChangesSub = dialogRef.componentInstance.queryChanges$.subscribe(
        this.searchQuery,
      );
    });
    dialogRef.afterClosed().subscribe((data) => {
      this.isDialogOpen.emit(false);
      queryChangesSub.unsubscribe();
      if (data && data.name) {
        if (annotation.id) {
          this.update.emit({
            id: annotation.id,
            videoId: annotation.videoId,
            label: data,
          });
        } else {
          this.setTmp.emit({ ...annotation, label: data });
        }
      } else {
        this.setMode.emit(NormalMode);
      }
    });
  }

  onAnnotationTap(ev, annotation): void {
    if (ev.tapCount === 1) {
      this.onAnnotationClick(annotation);
    }
    if (ev.tapCount === 2) {
      this.onAnnotationDblClick(annotation);
    }
  }

  onAnnotationClick(annotation: Annotation): void {
    if (this.currentMode === EditMode) {
      const initialAnnotation = this.displayedShapes.find(
        (a) => a.id === annotation.id,
      );
      this.setShape.emit(initialAnnotation.shape);
      this.setTmp.emit(initialAnnotation);
      this.drawnShape = {
        ...this.drawnShape,
        type: getAnnotationShapeType(initialAnnotation.shape),
        color: initialAnnotation.label?.color || this.drawnShape.color,
        name: initialAnnotation.label?.name || this.drawnShape.name,
      };
    }
  }

  onAnnotationHover(id: number): void {
    if (this.currentMode === EditMode && !this.tmpSvgAnnotation) {
      this.hovered = id;
    }
    this.hover.emit(id);
  }

  onAnnotationLeave(id: number): void {
    if (this.hovered === id) {
      this.hovered = null;
    }
    this.hover.emit(null);
  }

  isInitialShape(): boolean {
    if (this.isLineDrawing()) {
      return (
        this.drawnShape.x1 === this.initShape.x1 &&
        this.drawnShape.y1 === this.initShape.y1 &&
        this.drawnShape.x2 === this.initShape.x2 &&
        this.drawnShape.y2 === this.initShape.y2
      );
    }
    return (
      this.drawnShape.height === this.initShape.height &&
      this.drawnShape.posX === this.initShape.posX &&
      this.drawnShape.width === this.initShape.width &&
      this.drawnShape.posY === this.initShape.posY
    );
  }

  getCursor(x: number, y: number): string {
    const margin = 5;
    if (x == null || y == null || this.isInitialShape()) {
      this.dragHandle = null;
      return this.currentMode.cursor;
    } else if (this.isLineDrawing()) {
      const startDistance = Math.hypot(
        x - this.drawnShape.x1,
        y - this.drawnShape.y1,
      );
      const endDistance = Math.hypot(
        x - this.drawnShape.x2,
        y - this.drawnShape.y2,
      );
      if (startDistance <= margin * 2) {
        this.dragHandle = 'start';
        return 'crosshair';
      }
      if (endDistance <= margin * 2) {
        this.dragHandle = 'end';
        return 'crosshair';
      }
      const dx = this.drawnShape.x2 - this.drawnShape.x1;
      const dy = this.drawnShape.y2 - this.drawnShape.y1;
      const lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared) {
        this.dragHandle = null;
        return this.currentMode.cursor;
      }
      const projection = clamp(
        ((x - this.drawnShape.x1) * dx + (y - this.drawnShape.y1) * dy) /
          lengthSquared,
        0,
        1,
      );
      const projectedX = this.drawnShape.x1 + projection * dx;
      const projectedY = this.drawnShape.y1 + projection * dy;
      if (Math.hypot(x - projectedX, y - projectedY) <= margin * 2) {
        this.dragHandle = null;
        return 'move';
      }
      this.dragHandle = null;
      return this.currentMode.cursor;
    } else if (
      x >= this.drawnShape.posX - margin &&
      x <= this.drawnShape.posX + this.drawnShape.width + margin &&
      y >= this.drawnShape.posY - margin &&
      y <= this.drawnShape.posY + this.drawnShape.height + margin
    ) {
      if (
        y <= this.drawnShape.posY + margin &&
        y >= this.drawnShape.posY - margin
      ) {
        if (
          x <= this.drawnShape.posX + margin &&
          x >= this.drawnShape.posX - margin
        )
          return 'nw-resize';
        if (
          x <= this.drawnShape.posX + this.drawnShape.width + margin &&
          x >= this.drawnShape.posX + this.drawnShape.width - margin
        )
          return 'ne-resize';
        return 'n-resize';
      } else if (
        y <= this.drawnShape.posY + this.drawnShape.height + margin &&
        y >= this.drawnShape.posY + this.drawnShape.height - margin
      ) {
        if (
          x <= this.drawnShape.posX + margin &&
          x >= this.drawnShape.posX - margin
        )
          return 'sw-resize';
        if (
          x <= this.drawnShape.posX + this.drawnShape.width + margin &&
          x >= this.drawnShape.posX + this.drawnShape.width - margin
        )
          return 'se-resize';
        return 's-resize';
      } else if (
        x >= this.drawnShape.posX - margin &&
        x <= this.drawnShape.posX + margin
      ) {
        return 'w-resize';
      } else if (
        x <= this.drawnShape.posX + this.drawnShape.width + margin &&
        x >= this.drawnShape.posX + this.drawnShape.width - margin
      ) {
        return 'e-resize';
      } else {
        return 'move';
      }
    } else {
      return this.currentMode.cursor;
    }
  }

  createAnnotation(shape: AnnotationShape, label: AnnotationLabel): void {
    const nextShape = { ...shape, type: shape.type || this.drawingShapeType };
    this.setShape.emit(nextShape);
    const duration = 0;
    const newAnnotation: Annotation = {
      shape: nextShape,
      videoId: this.videoId,
      category: 'svg',
      label,
      duration,
      timestamp: this.currentTime,
      isOneShot: duration === Math.round(1000 / 30),
    };
    this.lastAnnotation = newAnnotation;
    this.drawnShape = {
      ...this.drawnShape,
      color: label.color,
      name: label.name,
    };
    this.setTmp.emit(newAnnotation);
  }

  @HostListener('contextmenu')
  onContextMenu(): boolean {
    return false;
  }

  resizeShape(): void {
    this.drawnShape = this.buildDrawnShapeFromPosition(
      this.getPositionAtCurrentTime(this.shape),
      getAnnotationShapeType(this.shape),
    );
  }

  /**
   * Scales a single stored position (ratio space) to pixel coordinates.
   * Kept private — only getPositionAtCurrentTime and interpolatePositions use it.
   */
  private scalePosition(position: AnnotationPosition): AnnotationPosition {
    if (isLineAnnotationPosition(position)) {
      return {
        x1: annotationsHelper.getWidthInPixels(
          position.x1,
          this.svgOverlay.width,
        ),
        y1: annotationsHelper.getHeightInPixels(
          position.y1,
          this.svgOverlay.height,
        ),
        x2: annotationsHelper.getWidthInPixels(
          position.x2,
          this.svgOverlay.width,
        ),
        y2: annotationsHelper.getHeightInPixels(
          position.y2,
          this.svgOverlay.height,
        ),
      };
    }
    return {
      x: annotationsHelper.getWidthInPixels(position.x, this.svgOverlay.width),
      y: annotationsHelper.getHeightInPixels(
        position.y,
        this.svgOverlay.height,
      ),
      width: annotationsHelper.getWidthInPixels(
        position.width,
        this.svgOverlay.width,
      ),
      height: annotationsHelper.getHeightInPixels(
        position.height,
        this.svgOverlay.height,
      ),
    };
  }

  /**
   * Linearly interpolates between two ratio-space positions by alpha (0→1),
   * then scales to pixels. All arithmetic is in ratio space so the result
   * is independent of current svgOverlay dimensions.
   * Falls back to scalePosition(prev) if the types are mismatched.
   */
  private interpolatePositions(
    prev: AnnotationPosition,
    next: AnnotationPosition,
    alpha: number,
  ): AnnotationPosition {
    if (isLineAnnotationPosition(prev) && isLineAnnotationPosition(next)) {
      return this.scalePosition({
        x1: prev.x1 + (next.x1 - prev.x1) * alpha,
        y1: prev.y1 + (next.y1 - prev.y1) * alpha,
        x2: prev.x2 + (next.x2 - prev.x2) * alpha,
        y2: prev.y2 + (next.y2 - prev.y2) * alpha,
      });
    }
    if (!isLineAnnotationPosition(prev) && !isLineAnnotationPosition(next)) {
      return this.scalePosition({
        x: prev.x + (next.x - prev.x) * alpha,
        y: prev.y + (next.y - prev.y) * alpha,
        width: prev.width + (next.width - prev.width) * alpha,
        height: prev.height + (next.height - prev.height) * alpha,
      });
    }
    // type mismatch (corrupted data) — hold prev
    return this.scalePosition(prev);
  }

  /**
   * Returns the interpolated pixel position of a shape at the current video time.
   *
   * BEFORE: held the last keyframe, causing shapes to snap between keyframes.
   * NOW: finds the surrounding keyframes and linearly interpolates, giving
   * smooth motion at any playback speed without requiring dense keyframes.
   *
   * Edge cases:
   *  - No positions        → zero rect (safe default)
   *  - Before first kf     → hold first keyframe
   *  - After last kf       → hold last keyframe
   *  - Exactly on a kf     → alpha = 0, exact keyframe value
   */
  getPositionAtCurrentTime(rectangle): AnnotationPosition {
    const defaultRect: AnnotationPosition = { x: 0, y: 0, width: 0, height: 0 };

    if (!rectangle?.positions) {
      return defaultRect;
    }

    const timestamps = Object.keys(rectangle.positions)
      .map(Number)
      .sort((a, b) => a - b);

    if (!timestamps.length) {
      return defaultRect;
    }

    const t = this.currentTime;

    // Hold first keyframe before it starts
    if (t <= timestamps[0]) {
      return this.scalePosition(rectangle.positions[timestamps[0]]);
    }

    // Hold last keyframe after it ends
    if (t >= timestamps[timestamps.length - 1]) {
      return this.scalePosition(
        rectangle.positions[timestamps[timestamps.length - 1]],
      );
    }

    // Bracket: find keyframe just before and just after current time
    const prevT = timestamps.filter((ts) => ts <= t).pop();
    const nextT = timestamps.find((ts) => ts > t);

    const prevPos = rectangle.positions[prevT];
    const nextPos = rectangle.positions[nextT];

    // alpha = 0 at prevT, alpha = 1 at nextT
    const alpha = (t - prevT) / (nextT - prevT);

    return this.interpolatePositions(prevPos, nextPos, alpha);
  }
}
