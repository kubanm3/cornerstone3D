import {
  getEnabledElement,
  cache,
  StackViewport,
  metaData,
  utilities as csUtils,
} from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

import { vec3 } from 'gl-matrix';
import {
  addAnnotation,
  getAnnotations,
  removeAnnotation,
} from '../../stateManagement';
import { isAnnotationLocked } from '../../stateManagement/annotation/annotationLocking';
import { triggerAnnotationModified } from '../../stateManagement/annotation/helpers/state';
import {
  drawHandles as drawHandlesSvg,
  drawRect as drawRectSvg,
} from '../../drawingSvg';
import { getViewportIdsWithToolToRender } from '../../utilities/viewportFilters';
import throttle from '../../utilities/throttle';
import { isAnnotationVisible } from '../../stateManagement/annotation/annotationVisibility';
import {
  hideElementCursor,
  resetElementCursor,
} from '../../cursors/elementCursor';
import triggerAnnotationRenderForViewportIds from '../../utilities/triggerAnnotationRenderForViewportIds';
import { triggerAnnotationCompleted } from '../../stateManagement/annotation/helpers/state';

import {
  PublicToolProps,
  ToolProps,
  EventTypes,
  SVGDrawingHelper,
} from '../../types';
import { RectangleROIStartEndThresholdAnnotation } from '../../types/ToolSpecificAnnotationTypes';
import RectangleROITool from '../annotation/RectangleROITool';
import { StyleSpecifier } from '../../types/AnnotationStyle';
import { pointInShapeCallback } from '../../utilities/';

const { transformWorldToIndex } = csUtils;

/**
 * This tool is similar to the RectangleROIThresholdTool which
 * only draws a rectangle on the image, and by using utility functions
 * such as thresholdByRange and thresholdByROIStat it can be used to
 * create a segmentation. The only difference is that it only acts on the
 * acquisition plane and not the 3D volume, and accepts a start and end
 * slice, and renders a dashed rectangle on the image between the start and end
 * but a solid rectangle on start and end slice. Utility functions should be used
 * to modify the start and end slice.
 * // Todo: right now only the first slice has grabbable handles, need to make
 * // it so that the handles are grabbable on all slices.
 */
class RectangleROIStartEndThresholdTool extends RectangleROITool {
  static toolName;
  _throttledCalculateCachedStats: any;
  editData: {
    annotation: any;
    viewportIdsToRender: string[];
    handleIndex?: number;
    newAnnotation?: boolean;
    hasMoved?: boolean;
  } | null;
  isDrawing: boolean;
  isHandleOutsideImage: boolean;

  constructor(
    toolProps: PublicToolProps = {},
    defaultToolProps: ToolProps = {
      configuration: {
        numSlicesToPropagate: 10,
        computePointsInsideVolume: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);

    this._throttledCalculateCachedStats = throttle(
      this._calculateCachedStatsTool,
      100,
      { trailing: true }
    );
  }

  /**
   * Based on the current position of the mouse and the enabledElement it creates
   * the edit data for the tool.
   *
   * @param evt -  EventTypes.NormalizedMouseEventType
   * @returns The annotation object.
   *
   */
  addNewAnnotation = (evt: EventTypes.InteractionEventType) => {
    const eventDetail = evt.detail;
    const { currentPoints, element } = eventDetail;
    const worldPos = currentPoints.world;

    const enabledElement = getEnabledElement(element);
    const { viewport, renderingEngine } = enabledElement;

    this.isDrawing = true;

    const camera = viewport.getCamera();
    const { viewPlaneNormal, viewUp } = camera;

    let referencedImageId, imageVolume, volumeId;
    if (viewport instanceof StackViewport) {
      throw new Error('Stack Viewport Not implemented');
    } else {
      const targetId = this.getTargetId(viewport);
      volumeId = targetId.split(/volumeId:|\?/)[1];
      imageVolume = cache.getVolume(volumeId);
      referencedImageId = csUtils.getClosestImageId(
        imageVolume,
        worldPos,
        viewPlaneNormal
      );
    }

    if (!referencedImageId) {
      throw new Error('This tool does not work on non-acquisition planes');
    }

    const startIndex = viewport.getCurrentImageIdIndex();
    const spacingInNormal = csUtils.getSpacingInNormalDirection(
      imageVolume,
      viewPlaneNormal
    );

    // We cannot simply add numSlicesToPropagate to startIndex because
    // the order of imageIds can be from top to bottom or bottom to top and
    // we want to make sure it is always propagated in the direction of the
    // view and also to make sure we don't go out of bounds.
    const endIndex = this._getEndSliceIndex(
      imageVolume,
      worldPos,
      spacingInNormal,
      viewPlaneNormal
    );

    const FrameOfReferenceUID = viewport.getFrameOfReferenceUID();

    const annotation = {
      highlighted: true,
      invalidated: true,
      metadata: {
        viewPlaneNormal: <Types.Point3>[...viewPlaneNormal],
        enabledElement,
        viewUp: <Types.Point3>[...viewUp],
        FrameOfReferenceUID,
        referencedImageId,
        toolName: this.getToolName(),
        volumeId,
        spacingInNormal,
      },
      data: {
        label: '',
        startSlice: startIndex,
        endSlice: endIndex,
        cachedStats: {
          pointsInVolume: [],
          projectionPoints: [],
          projectionPointsImageIds: [referencedImageId],
        },
        handles: {
          // No need a textBox
          textBox: {
            hasMoved: false,
            worldPosition: null,
            worldBoundingBox: null,
          },
          points: [
            <Types.Point3>[...worldPos],
            <Types.Point3>[...worldPos],
            <Types.Point3>[...worldPos],
            <Types.Point3>[...worldPos],
          ],
          activeHandleIndex: null,
        },
        labelmapUID: null,
      },
    };

    // update the projection points in 3D space, since we are projecting
    // the points to the slice plane, we need to make sure the points are
    // computed for later export
    this._computeProjectionPoints(annotation, imageVolume);

    addAnnotation(annotation, element);

    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );

    this.editData = {
      annotation,
      viewportIdsToRender,
      handleIndex: 3,
      newAnnotation: true,
      hasMoved: false,
    };
    this._activateDraw(element);

    hideElementCursor(element);

    evt.preventDefault();

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    return annotation;
  };

  _endCallback = (evt: EventTypes.InteractionEventType): void => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    const { annotation, viewportIdsToRender, newAnnotation, hasMoved } =
      this.editData;
    const { data } = annotation;

    if (newAnnotation && !hasMoved) {
      return;
    }

    data.handles.activeHandleIndex = null;

    this._deactivateModify(element);
    this._deactivateDraw(element);

    resetElementCursor(element);

    const enabledElement = getEnabledElement(element);

    this.editData = null;
    this.isDrawing = false;

    if (
      this.isHandleOutsideImage &&
      this.configuration.preventHandleOutsideImage
    ) {
      removeAnnotation(annotation.annotationUID);
    }

    const targetId = this.getTargetId(enabledElement.viewport);
    const imageVolume = cache.getVolume(targetId.split(/volumeId:|\?/)[1]);

    if (this.configuration.calculatePointsInsideVolume) {
      this._computePointsInsideVolume(annotation, imageVolume, enabledElement);
    }

    triggerAnnotationRenderForViewportIds(
      enabledElement.renderingEngine,
      viewportIdsToRender
    );

    if (newAnnotation) {
      triggerAnnotationCompleted(annotation);
    }
  };

  // Todo: make it work for planes other than acquisition planes
  _computeProjectionPoints(
    annotation: RectangleROIStartEndThresholdAnnotation,
    imageVolume: Types.IImageVolume
  ): void {
    const { data, metadata } = annotation;
    const { viewPlaneNormal, spacingInNormal } = metadata;
    const { imageData } = imageVolume;
    const { startSlice, endSlice } = data;
    const { points } = data.handles;

    const startIJK = transformWorldToIndex(imageData, points[0]);

    if (startIJK[2] !== startSlice) {
      throw new Error('Start slice does not match');
    }

    // substitute the end slice index 2 with startIJK index 2
    const endIJK = vec3.fromValues(startIJK[0], startIJK[1], endSlice);

    const startWorld = vec3.create();
    imageData.indexToWorldVec3(startIJK, startWorld);

    const endWorld = vec3.create();
    imageData.indexToWorldVec3(endIJK, endWorld);

    // distance between start and end slice in the world coordinate
    const distance = vec3.distance(startWorld, endWorld);

    // for each point inside points, navigate in the direction of the viewPlaneNormal
    // with amount of spacingInNormal, and calculate the next slice until we reach the distance
    const newProjectionPoints = [];
    for (let dist = 0; dist < distance; dist += spacingInNormal) {
      newProjectionPoints.push(
        points.map((point) => {
          const newPoint = vec3.create();
          vec3.scaleAndAdd(newPoint, point, viewPlaneNormal, dist);
          return Array.from(newPoint);
        })
      );
    }

    data.cachedStats.projectionPoints = newProjectionPoints;

    // Find the imageIds for the projection points
    const projectionPointsImageIds = [];
    for (const RectanglePoints of newProjectionPoints) {
      const imageId = csUtils.getClosestImageId(
        imageVolume,
        RectanglePoints[0],
        viewPlaneNormal
      );
      projectionPointsImageIds.push(imageId);
    }

    data.cachedStats.projectionPointsImageIds = projectionPointsImageIds;
  }

  //This function return all the points inside the ROI for every slices between startSlice and endSlice
  _computePointsInsideVolume(annotation, imageVolume, enabledElement) {
    const { data } = annotation;
    const projectionPoints = data.cachedStats.projectionPoints;

    const pointsInsideVolume: Types.Point3[][] = [[]];

    for (let i = 0; i < projectionPoints.length; i++) {
      // If image does not exists for the targetId, skip. This can be due
      // to various reasons such as if the target was a volumeViewport, and
      // the volumeViewport has been decached in the meantime.
      if (!imageVolume) {
        continue;
      }

      const projectionPoint = projectionPoints[i][0];

      const worldPos1 = data.handles.points[0];
      const worldPos2 = data.handles.points[3];

      const { dimensions, imageData } = imageVolume;

      const worldPos1Index = transformWorldToIndex(imageData, worldPos1);
      //We only need to change the Z of our bounds so we are getting the Z from the current projection point
      const worldProjectionPointIndex = transformWorldToIndex(
        imageData,
        projectionPoint
      );

      worldPos1Index[0] = Math.floor(worldPos1Index[0]);
      worldPos1Index[1] = Math.floor(worldPos1Index[1]);
      worldPos1Index[2] = Math.floor(worldProjectionPointIndex[2]);

      const worldPos2Index = transformWorldToIndex(imageData, worldPos2);

      worldPos2Index[0] = Math.floor(worldPos2Index[0]);
      worldPos2Index[1] = Math.floor(worldPos2Index[1]);
      worldPos2Index[2] = Math.floor(worldProjectionPointIndex[2]);

      // Check if one of the indexes are inside the volume, this then gives us
      // Some area to do stats over.

      if (this._isInsideVolume(worldPos1Index, worldPos2Index, dimensions)) {
        this.isHandleOutsideImage = false;
        const iMin = Math.min(worldPos1Index[0], worldPos2Index[0]);
        const iMax = Math.max(worldPos1Index[0], worldPos2Index[0]);

        const jMin = Math.min(worldPos1Index[1], worldPos2Index[1]);
        const jMax = Math.max(worldPos1Index[1], worldPos2Index[1]);

        const kMin = Math.min(worldPos1Index[2], worldPos2Index[2]);
        const kMax = Math.max(worldPos1Index[2], worldPos2Index[2]);

        const boundsIJK = [
          [iMin, iMax],
          [jMin, jMax],
          [kMin, kMax],
        ] as [Types.Point2, Types.Point2, Types.Point2];

        const pointsInShape = pointInShapeCallback(
          imageData,
          () => true,
          null,
          boundsIJK
        );

        //@ts-ignore
        pointsInsideVolume.push(pointsInShape);
      }
    }
    data.cachedStats.pointsInVolume = pointsInsideVolume;
  }

  _calculateCachedStatsTool(annotation, enabledElement) {
    const data = annotation.data;
    const { element, viewport } = enabledElement;

    const { cachedStats } = data;
    const targetId = this.getTargetId(viewport);
    const imageVolume = cache.getVolume(targetId.split(/volumeId:|\?/)[1]);

    // Todo: this shouldn't be here, this is a performance issue
    // Since we are extending the RectangleROI class, we need to
    // bring the logic for handle to some cachedStats calculation
    this._computeProjectionPoints(annotation, imageVolume);

    annotation.invalidated = false;

    // Dispatching annotation modified
    triggerAnnotationModified(annotation, element);

    return cachedStats;
  }

  /**
   * it is used to draw the rectangleROIStartEnd annotation in each
   * request animation frame.
   *
   * @param enabledElement - The Cornerstone's enabledElement.
   * @param svgDrawingHelper - The svgDrawingHelper providing the context for drawing.
   */
  renderAnnotation = (
    enabledElement: Types.IEnabledElement,
    svgDrawingHelper: SVGDrawingHelper
  ): boolean => {
    let renderStatus = false;
    const { viewport } = enabledElement;

    const annotations = getAnnotations(this.getToolName(), viewport.element);

    if (!annotations?.length) {
      return renderStatus;
    }

    const sliceIndex = viewport.getCurrentImageIdIndex();

    const styleSpecifier: StyleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: enabledElement.viewport.id,
    };

    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[
        i
      ] as RectangleROIStartEndThresholdAnnotation;
      const { annotationUID, data } = annotation;
      const { startSlice, endSlice } = data;
      const { points, activeHandleIndex } = data.handles;

      const canvasCoordinates = points.map((p) => viewport.worldToCanvas(p));

      styleSpecifier.annotationUID = annotationUID;

      const lineWidth = this.getStyle('lineWidth', styleSpecifier, annotation);
      const lineDash = this.getStyle('lineDash', styleSpecifier, annotation);
      const color = this.getStyle('color', styleSpecifier, annotation);
      // range of slices to render based on the start and end slice, like
      // np.arange

      // if indexIJK is outside the start/end slice, we don't render
      if (
        sliceIndex < Math.min(startSlice, endSlice) ||
        sliceIndex > Math.max(startSlice, endSlice)
      ) {
        continue;
      }

      // WE HAVE TO CACHE STATS BEFORE FETCHING TEXT

      if (annotation.invalidated) {
        this._throttledCalculateCachedStats(annotation, enabledElement);
      }

      // if it is inside the start/end slice, but not exactly the first or
      // last slice, we render the line in dash, but not the handles
      let firstOrLastSlice = false;
      if (sliceIndex === startSlice || sliceIndex === endSlice) {
        firstOrLastSlice = true;
      }

      // If rendering engine has been destroyed while rendering
      if (!viewport.getRenderingEngine()) {
        console.warn('Rendering Engine has been destroyed');
        return renderStatus;
      }

      let activeHandleCanvasCoords;

      if (!isAnnotationVisible(annotationUID)) {
        continue;
      }

      if (
        !isAnnotationLocked(annotation) &&
        !this.editData &&
        activeHandleIndex !== null &&
        firstOrLastSlice
      ) {
        // Not locked or creating and hovering over handle, so render handle.
        activeHandleCanvasCoords = [canvasCoordinates[activeHandleIndex]];
      }

      if (activeHandleCanvasCoords) {
        const handleGroupUID = '0';

        drawHandlesSvg(
          svgDrawingHelper,
          annotationUID,
          handleGroupUID,
          activeHandleCanvasCoords,
          {
            color,
          }
        );
      }

      let lineDashToUse = lineDash;

      if (!firstOrLastSlice) {
        lineDashToUse = 2;
      }

      const rectangleUID = '0';
      drawRectSvg(
        svgDrawingHelper,
        annotationUID,
        rectangleUID,
        canvasCoordinates[0],
        canvasCoordinates[3],
        {
          color,
          lineDash: lineDashToUse,
          lineWidth,
        }
      );

      renderStatus = true;
    }

    return renderStatus;
  };

  _getEndSliceIndex(
    imageVolume: Types.IImageVolume,
    worldPos: Types.Point3,
    spacingInNormal: number,
    viewPlaneNormal: Types.Point3
  ): number | undefined {
    const numSlicesToPropagate = this.configuration.numSlicesToPropagate;

    // get end position by moving from worldPos in the direction of viewplaneNormal
    // with amount of numSlicesToPropagate * spacingInNormal
    const endPos = vec3.create();
    vec3.scaleAndAdd(
      endPos,
      worldPos,
      viewPlaneNormal,
      numSlicesToPropagate * spacingInNormal
    );

    const halfSpacingInNormalDirection = spacingInNormal / 2;
    // Loop through imageIds of the imageVolume and find the one that is closest to endPos
    const { imageIds } = imageVolume;
    let imageIdIndex;
    for (let i = 0; i < imageIds.length; i++) {
      const imageId = imageIds[i];

      const { imagePositionPatient } = metaData.get(
        'imagePlaneModule',
        imageId
      );

      const dir = vec3.create();
      vec3.sub(dir, endPos, imagePositionPatient);

      const dot = vec3.dot(dir, viewPlaneNormal);

      if (Math.abs(dot) < halfSpacingInNormalDirection) {
        imageIdIndex = i;
      }
    }

    return imageIdIndex;
  }
}

RectangleROIStartEndThresholdTool.toolName = 'RectangleROIStartEndThreshold';
export default RectangleROIStartEndThresholdTool;
