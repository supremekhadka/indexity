import { isNull, range, cloneDeep } from 'lodash';

import { AnnotationEntity } from '../../annotations/entities/annotation.entity';
import {
  isLineSurgPosition,
  LineSurgPosition,
  RectangleSurgPosition,
  SurgPosition,
} from '../../annotations/interfaces/surg-shape.interface';

interface TimestampedPositions {
  [timestamp: string]: SurgPosition;
}

interface Point {
  timestamp: number;
  position: SurgPosition;
}

const FRAME_SIZE_IN_PERCENTS = 100;
const clampToFrame = (value: number): number =>
  Math.min(FRAME_SIZE_IN_PERCENTS, Math.max(0, value));

const isSamePosition = (p1: SurgPosition, p2: SurgPosition): boolean => {
  if (isLineSurgPosition(p1) || isLineSurgPosition(p2)) {
    return (
      isLineSurgPosition(p1) &&
      isLineSurgPosition(p2) &&
      p1.x1 === p2.x1 &&
      p1.y1 === p2.y1 &&
      p1.x2 === p2.x2 &&
      p1.y2 === p2.y2
    );
  }

  const rectangle1 = p1 as RectangleSurgPosition;
  const rectangle2 = p2 as RectangleSurgPosition;
  return (
    rectangle1.x === rectangle2.x &&
    rectangle1.y === rectangle2.y &&
    rectangle1.width === rectangle2.width &&
    rectangle1.height === rectangle2.height
  );
};

export const rectifyPositions = (
  positions: TimestampedPositions,
): { changed: boolean; result: TimestampedPositions } => {
  const result: TimestampedPositions = {};
  let changed = false;
  Object.keys(positions).map(timestamp => {
    const position = positions[timestamp];

    if (isLineSurgPosition(position)) {
      const fixedPosition: LineSurgPosition = {
        x1: clampToFrame(position.x1),
        y1: clampToFrame(position.y1),
        x2: clampToFrame(position.x2),
        y2: clampToFrame(position.y2),
      };
      changed = changed || !isSamePosition(position, fixedPosition);
      result[timestamp] = fixedPosition;
      return;
    }

    let x = position.x;
    let y = position.y;
    let width = position.width;
    let height = position.height;
    if (x < 0) {
      width = width + x;
      x = 0;
      changed = true;
    }
    if (y < 0) {
      height = height + y;
      y = 0;
      changed = true;
    }
    if (x + width > FRAME_SIZE_IN_PERCENTS) {
      width = FRAME_SIZE_IN_PERCENTS - x;
      changed = true;
    }
    if (y + height > FRAME_SIZE_IN_PERCENTS) {
      height = FRAME_SIZE_IN_PERCENTS - y;
      changed = true;
    }
    result[timestamp] = {
      x,
      y,
      width,
      height,
    };
  });
  return {
    changed,
    result,
  };
};

export const removeDuplicatedPositions = (
  positions: TimestampedPositions,
): TimestampedPositions => {
  let lastPosition: SurgPosition = null;
  const result: TimestampedPositions = {};
  Object.keys(positions).map(timestamp => {
    if (isNull(lastPosition) || !isSamePosition(lastPosition, positions[timestamp])) {
      result[timestamp] = positions[timestamp];
      lastPosition = positions[timestamp];
    }
  });
  return result;
};

// Interpolation of annotations

const linearInterpolation = (
  xA: number,
  yA: number,
  xB: number,
  yB: number,
  x: number,
): number => {
  return yA + (x - xA) * ((yB - yA) / (xB - xA));
};

const getPositionsBetween = (
  p1: Point,
  p2: Point,
  ts: number,
): SurgPosition | undefined => {
  if (p1.timestamp < ts && ts < p2.timestamp) {
    if (p1.timestamp === ts) {
      return p1.position;
    } else if (p2.timestamp === ts) {
      return p2.position;
    } else {
      const pos1 = p1.position;
      const pos2 = p2.position;

      if (isLineSurgPosition(pos1) || isLineSurgPosition(pos2)) {
        if (!isLineSurgPosition(pos1) || !isLineSurgPosition(pos2)) {
          return undefined;
        }

        return {
          x1: linearInterpolation(
            p1.timestamp,
            pos1.x1,
            p2.timestamp,
            pos2.x1,
            ts,
          ),
          y1: linearInterpolation(
            p1.timestamp,
            pos1.y1,
            p2.timestamp,
            pos2.y1,
            ts,
          ),
          x2: linearInterpolation(
            p1.timestamp,
            pos1.x2,
            p2.timestamp,
            pos2.x2,
            ts,
          ),
          y2: linearInterpolation(
            p1.timestamp,
            pos1.y2,
            p2.timestamp,
            pos2.y2,
            ts,
          ),
        };
      }

      const x = linearInterpolation(
        p1.timestamp,
        pos1.x,
        p2.timestamp,
        pos2.x,
        ts,
      );
      const y = linearInterpolation(
        p1.timestamp,
        pos1.y,
        p2.timestamp,
        pos2.y,
        ts,
      );
      const width = linearInterpolation(
        p1.timestamp,
        pos1.width,
        p2.timestamp,
        pos2.width,
        ts,
      );
      const height = linearInterpolation(
        p1.timestamp,
        pos1.height,
        p2.timestamp,
        pos2.height,
        ts,
      );

      return { x, y, width, height };
    }
  }
};

export const addInterpolatedPositions = (
  annotation: AnnotationEntity,
  step: number,
): AnnotationEntity => {
  if (!annotation.shape || !annotation.shape.positions) {
    return annotation;
  }
  const timestamps = Object.keys(annotation.shape.positions)
    .map(t => parseInt(t))
    .sort((a, b) => a - b);
  if (timestamps.length < 1) {
    return annotation;
  }
  const { positions } = annotation.shape;
  const newPositions = { ...positions };

  timestamps.map((currentTs, index, array) => {
    const currentPos = positions[currentTs.toString()];

    if (index === array.length - 1) {
      const lastTimestamp = annotation.timestamp + annotation.duration;
      const intermediateTs = range(currentTs + step, lastTimestamp, step);
      intermediateTs.map(t => {
        newPositions[t] = currentPos;
      });
      newPositions[lastTimestamp] = currentPos;
      return;
    }

    const nextTs = array[index + 1];
    const nextPos = positions[nextTs.toString()];
    const intermediateTs = range(currentTs + step, nextTs, step);

    intermediateTs.map(t => {
      const intermediatePos = getPositionsBetween(
        { timestamp: currentTs, position: currentPos },
        { timestamp: nextTs, position: nextPos },
        t,
      );
      if (intermediatePos) {
        newPositions[t] = intermediatePos;
      }
    });
  });

  const interpolatedAnnotation = cloneDeep(annotation);
  interpolatedAnnotation.shape.positions = newPositions;
  return interpolatedAnnotation;
};

/**
 * Removes private user information in annotation (password, ip address and email)
 * @param annotation - annotation to clean
 * @returns {AnnotationEntity} - cleaned annotation
 */
export const cleanAnnotation = (
  annotation: AnnotationEntity,
): AnnotationEntity => {
  if (!annotation.user) {
    return annotation;
  }
  const cleanedAnnotation = cloneDeep(annotation);
  delete cleanedAnnotation.user.password;
  delete cleanedAnnotation.user.ipAddress;
  delete cleanedAnnotation.user.email;

  return cleanedAnnotation;
};
