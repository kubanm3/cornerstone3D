import type { Types } from '@cornerstonejs/core';

// Returns sign of number
function sign(x: number | string): number {
  return typeof x === 'number'
    ? x
      ? x < 0
        ? -1
        : 1
      : x === x
      ? 0
      : NaN
    : NaN;
}

/**
 * Calculates the intersection point between two lines in the 2D plane
 *
 * @param line1Start - x,y coordinates of the start of the first line
 * @param line1End - x,y coordinates of the end of the first line
 * @param line2Start - x,y coordinates of the start of the second line
 * @param line2End - x,y coordinates of the end of the second line
 * @param infinite - if true, treat lines as infinite; if false, check segment bounds (default: false)
 * @returns [x,y] - point x,y of the point, or undefined if no intersection
 */

export default function intersectLine(
  line1Start: Types.Point2,
  line1End: Types.Point2,
  line2Start: Types.Point2,
  line2End: Types.Point2,
  infinite: boolean = false
): number[] | undefined {
  const [x1, y1] = line1Start;
  const [x2, y2] = line1End;
  const [x3, y3] = line2Start;
  const [x4, y4] = line2End;

  if (infinite) {
    // Check for parallel lines using determinant
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

    if (Math.abs(denom) < 1e-10) {
      return undefined; // Lines are parallel or coincident
    }
    // For infinite lines, use the simpler parametric approach
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const x = x1 + t * (x2 - x1);
    const y = y1 + t * (y2 - y1);
    return [x, y];
  }

  // For line segments, use the original algorithm with bounds checking
  // Compute a1, b1, c1, where line joining points 1 and 2 is "a1 x  +  b1 y  +  c1  =  0"
  const a1 = y2 - y1;
  const b1 = x1 - x2;
  const c1 = x2 * y1 - x1 * y2;

  // Compute r3 and r4
  const r3 = a1 * x3 + b1 * y3 + c1;
  const r4 = a1 * x4 + b1 * y4 + c1;

  /* Check signs of r3 and r4.  If both point 3 and point 4 lie on
   * same side of line 1, the line segments do not intersect.
   */

  if (r3 !== 0 && r4 !== 0 && sign(r3) === sign(r4)) {
    return undefined;
  }

  // Compute a2, b2, c2
  const a2 = y4 - y3;
  const b2 = x3 - x4;
  const c2 = x4 * y3 - x3 * y4;

  // Compute r1 and r2
  const r1 = a2 * x1 + b2 * y1 + c2;
  const r2 = a2 * x2 + b2 * y2 + c2;

  /* Check signs of r1 and r2.  If both point 1 and point 2 lie
   * on same side of second line segment, the line segments do
   * not intersect.
   */

  if (r1 !== 0 && r2 !== 0 && sign(r1) === sign(r2)) {
    return undefined;
  }

  /* Line segments intersect: compute intersection point.
   */

  const denomSegment = a1 * b2 - a2 * b1;
  let num;

  /* The denom/2 is to get rounding instead of truncating.  It
   * is added or subtracted to the numerator, depending upon the
   * sign of the numerator.
   */

  num = b1 * c2 - b2 * c1;
  const x = num / denomSegment;

  num = a2 * c1 - a1 * c2;
  const y = num / denomSegment;

  const intersectionPoint = [x, y];

  return intersectionPoint;
}
