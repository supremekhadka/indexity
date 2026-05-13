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
  // To setup the svg position on top of the video
  @Input() svgOverlay = {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  };
  @Input() shape: AnnotationShape = {
    positions: {},
  };

  // Video
  @Input() currentTime = 0;
  @Input() videoDuration = 0;
  @Input() videoId = null;

  // Annotations
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
  initialDrawnShape = null;

  // flags to signal in which state we are
  rectangleMoving = false;
  rectangleDrawing = false;
  // flag to signal if the cursor is out of the svg area
  svgLeave = false;

  cursor = 'default';

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
  drawnShape: {
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
  } = {
    ...this.initShape,
  };
  lastAnnotation: Annotation;
  structureDisplayedShapes: Array<Annotation> = [];

  searchResults$ = new BehaviorSubject<AnnotationLabel[]>([]);

  /**
   * Track annotations by id
   */
  annotationsTrackBy = (index, annotation): any => annotation.id;

  /**
   * @ignore
   */
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
        ...this.annotationToUpdate.label,
      };
    }

    if (
      changes.currentMode &&
      changes.currentMode.currentValue !== changes.currentMode.previousValue
    ) {
      this.cursor = this.currentMode.cursor;
      if (changes.currentMode.previousValue !== NormalMode) {
        this.initialDrawnShape = null;
        this.drawnShape = {
          ...this.initShape,
        };
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
      this.shape = {
        type: this.drawingShapeType,
        positions: {},
      };
    }
  }

  isDrawnShapeVisible(): boolean {
    if (isDrawingMode(this.currentMode)) {
      return true;
    } else if (this.currentMode === EditMode && this.tmpSvgAnnotation) {
      return annotationsHelper.isAt(this.currentTime)(this.tmpSvgAnnotation);
    } else {
      return false;
    }
  }

  @HostListener('mouseleave')
  onMouseLeave(): boolean {
    if (this.rectangleDrawing) {
      this.svgLeave = true;
      // If we are drawing, we stop all actions and send the mouseup signal.
      this.onMouseUp();
    }
    return false; // Call preventDefault() on the event
  }

  /**
   * Sets drawn shape position at tmp annotation position at current time
   */
  setDrawnShapePositionAtCurrentTime(): void {
    const annotationWithCurrentChanges = cloneDeep(this.tmpSvgAnnotation);
    annotationWithCurrentChanges.shape.positions = {
      ...annotationWithCurrentChanges.shape.positions,
      ...this.shape.positions,
    };
    const currentPosition = this.getPositionAtCurrentTime(
      annotationWithCurrentChanges.shape,
    );
    const isLine = isLineAnnotationPosition(currentPosition);
    this.drawnShape = {
      ...this.drawnShape,
      type: getAnnotationShapeType(annotationWithCurrentChanges.shape),
      height: isLine
        ? Math.abs(currentPosition.y2 - currentPosition.y1)
        : currentPosition.height,
      width: isLine
        ? Math.abs(currentPosition.x2 - currentPosition.x1)
        : currentPosition.width,
      posX: isLine
        ? Math.min(currentPosition.x1, currentPosition.x2)
        : currentPosition.x,
      posY: isLine
        ? Math.min(currentPosition.y1, currentPosition.y2)
        : currentPosition.y,
      x1: isLine ? currentPosition.x1 : currentPosition.x,
      y1: isLine ? currentPosition.y1 : currentPosition.y,
      x2: isLine
        ? currentPosition.x2
        : currentPosition.x + currentPosition.width,
      y2: isLine
        ? currentPosition.y2
        : currentPosition.y + currentPosition.height,
    };
  }

  toLineDrawnShape(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): typeof this.drawnShape {
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

  @HostListener('mouseenter')
  onMouseEnter(): boolean {
    if (this.rectangleDrawing) {
      this.svgLeave = false;
    }
    return false; // Call preventDefault() on the event
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
      this.rectangleMoving = true;
      this.initialDrawnShape = cloneDeep(this.drawnShape);
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
    return false; // Call preventDefault() on the event
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
      // If the mouse leave the SVG area, we don't want to do anything here.
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

      // We update the list of positions in relation with stream time
      this.updatePositions();
    } else {
      this.cursor = this.getCursor(x, y);
    }
    return false; // Call preventDefault() on the event
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event): void {
    if (
      event.ctrlKey &&
      (isDrawingMode(this.currentMode) || this.currentMode === EditMode) &&
      this.tmpSvgAnnotation
    ) {
      this.cursor = 'move';
      // CTRL + LEFT ARROW
      if (event.key === 'ArrowLeft') {
        this.moveLeft();
      } else if (event.key === 'ArrowUp') {
        // CTRL + UP ARROW
        this.moveUp();
      } else if (event.key === 'ArrowRight') {
        // CTRL + RIGHT ARROW
        this.moveRight();
      } else if (event.key === 'ArrowDown') {
        // CTRL + DOWN ARROW
        this.moveDown();
      }
    } else if (event.key === 'ArrowLeft') {
      // LEFT ARROW
      this.seekBackward.emit();
    } else if (event.key === 'ArrowRight') {
      // RIGHT ARROW
      this.seekForward.emit();
    }
    // ALT + J
    if (event.altKey && event.code === 'KeyJ' && this.lastAnnotation) {
      this.setMode.emit(
        this.isLineShape(this.lastAnnotation.shape) ? LineDrawingMode : DrawingMode,
      );
      const lastPositionTimestamp = Object.keys(
        this.lastAnnotation.shape.positions,
      )
        .sort((a, b) => {
          if (+a > +b) {
            return 1;
          }
          if (+a < +b) {
            return -1;
          }
          return 0;
        })
        .pop();
      const newShape = {
        ...this.lastAnnotation.shape,
        positions: {},
      };
      newShape.positions[
        this.currentTime
      ] = this.lastAnnotation.shape.positions[lastPositionTimestamp];

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
    const positions = {
      ...this.shape.positions,
    };
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
      const shape = {
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
        const annotation = {
          ...this.tmpSvgAnnotation,
          shape: {
            ...shape,
          },
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
      const initialShape = this.initialDrawnShape || this.drawnShape;
      if (this.cursor === 'move' || touchEvent) {
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
      } else if (this.cursor === 'line-start') {
        this.drawnShape = this.toLineDrawnShape(
          clamp(offsetX, 0, this.svgOverlay.width),
          clamp(offsetY, 0, this.svgOverlay.height),
          initialShape.x2,
          initialShape.y2,
        );
      } else if (this.cursor === 'line-end') {
        this.drawnShape = this.toLineDrawnShape(
          initialShape.x1,
          initialShape.y1,
          clamp(offsetX, 0, this.svgOverlay.width),
          clamp(offsetY, 0, this.svgOverlay.height),
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
        this.drawnShape = {
          ...this.drawnShape,
          height: newHeight,
        };
      }
    } else if (this.cursor === 'e-resize') {
      const newWidth = offsetX - this.drawnShape.posX;
      if (newWidth >= minWidthAndHeight) {
        this.drawnShape = {
          ...this.drawnShape,
          width: newWidth,
        };
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

    const positions = {
      ...this.shape.positions,
    };
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
      const shape = {
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
            this.drawnShape = {
              ...this.initShape,
            };
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
    return false; // Call preventDefault() on the event
  }

  onAnnotationDblClick(annotation: Annotation): void {
    const dialogRef = this.dialog.open(SvgAnnotationFormDialogComponent, {
      width: '600px',
      data: {
        enableDelete: this.labelDeletion,
        labels$: this.searchResults$,
        allowedLabelTypes: ['structure'],
        suggestedLabelGroup: this.suggestedLabelGroup,
        currentLabel: {
          ...annotation.label,
        },
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
          const updates = {
            id: annotation.id,
            videoId: annotation.videoId,
            label: data,
          };
          this.update.emit(updates);
        } else {
          this.setTmp.emit({
            ...annotation,
            label: data,
          });
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
        ...initialAnnotation.label,
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
      return this.currentMode.cursor;
    } else if (this.isLineDrawing()) {
      const startDistance = Math.hypot(x - this.drawnShape.x1, y - this.drawnShape.y1);
      const endDistance = Math.hypot(x - this.drawnShape.x2, y - this.drawnShape.y2);
      if (startDistance <= margin * 2) {
        return 'line-start';
      }
      if (endDistance <= margin * 2) {
        return 'line-end';
      }

      const dx = this.drawnShape.x2 - this.drawnShape.x1;
      const dy = this.drawnShape.y2 - this.drawnShape.y1;
      const lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared) {
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
      return Math.hypot(x - projectedX, y - projectedY) <= margin * 2
        ? 'move'
        : this.currentMode.cursor;
    } else if (
      x >= this.drawnShape.posX - margin &&
      x <= this.drawnShape.posX + this.drawnShape.width + margin &&
      y >= this.drawnShape.posY - margin &&
      y <= this.drawnShape.posY + this.drawnShape.height + margin
    ) {
      // in the rectangle
      if (
        y <= this.drawnShape.posY + margin &&
        y >= this.drawnShape.posY - margin
      ) {
        // top
        if (
          x <= this.drawnShape.posX + margin &&
          x >= this.drawnShape.posX - margin
        ) {
          // NW
          return 'nw-resize';
        } else if (
          x <= this.drawnShape.posX + this.drawnShape.width + margin &&
          x >= this.drawnShape.posX + this.drawnShape.width - margin
        ) {
          // NE
          return 'ne-resize';
        } else {
          // N
          return 'n-resize';
        }
      } else if (
        y <= this.drawnShape.posY + this.drawnShape.height + margin &&
        y >= this.drawnShape.posY + this.drawnShape.height - margin
      ) {
        // bottom
        if (
          x <= this.drawnShape.posX + margin &&
          x >= this.drawnShape.posX - margin
        ) {
          // SW
          return 'sw-resize';
        } else if (
          x <= this.drawnShape.posX + this.drawnShape.width + margin &&
          x >= this.drawnShape.posX + this.drawnShape.width - margin
        ) {
          // SE
          return 'se-resize';
        } else {
          // S
          return 's-resize';
        }
      } else if (
        x >= this.drawnShape.posX - margin &&
        x <= this.drawnShape.posX + margin
      ) {
        // left
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
    const nextShape = {
      ...shape,
      type: shape.type || this.drawingShapeType,
    };
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

  /**
   * Resize the visible shape when the scene changes
   */
  resizeShape(): void {
    const currentPosition = this.getPositionAtCurrentTime(this.shape);
    const isLine = isLineAnnotationPosition(currentPosition);
    this.drawnShape = {
      ...this.drawnShape,
      type: getAnnotationShapeType(this.shape),
      height: isLine
        ? Math.abs(currentPosition.y2 - currentPosition.y1)
        : currentPosition.height,
      width: isLine
        ? Math.abs(currentPosition.x2 - currentPosition.x1)
        : currentPosition.width,
      posX: isLine
        ? Math.min(currentPosition.x1, currentPosition.x2)
        : currentPosition.x,
      posY: isLine
        ? Math.min(currentPosition.y1, currentPosition.y2)
        : currentPosition.y,
      x1: isLine ? currentPosition.x1 : currentPosition.x,
      y1: isLine ? currentPosition.y1 : currentPosition.y,
      x2: isLine
        ? currentPosition.x2
        : currentPosition.x + currentPosition.width,
      y2: isLine
        ? currentPosition.y2
        : currentPosition.y + currentPosition.height,
    };
  }

  /**
   * Move the rectangle according to its set of positions and the current time of the stream
   * @returns X and Y latest coordinates of the rectangle at current time
   */
  getPositionAtCurrentTime(
    rectangle,
  ): AnnotationPosition {
    let res: AnnotationPosition = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    if (rectangle && rectangle.positions) {
      const lastTimeStamp = Object.keys(rectangle.positions)
        .reverse()
        .find((timestamp) => {
          return +timestamp <= this.currentTime;
        });
      if (lastTimeStamp) {
        const position = rectangle.positions[lastTimeStamp];
        res = isLineAnnotationPosition(position)
          ? {
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
            }
          : {
              x: annotationsHelper.getWidthInPixels(
                position.x,
                this.svgOverlay.width,
              ),
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
    }
    return res;
  }
}
