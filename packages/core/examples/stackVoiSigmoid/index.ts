import type { Types } from '@cornerstonejs/core';
import {
  RenderingEngine,
  Enums,
  getRenderingEngine,
} from '@cornerstonejs/core';
import {
  initDemo,
  createImageIdsAndCacheMetaData,
  setTitleAndDescription,
  addButtonToToolbar,
} from '../../../../utils/demo/helpers';
import * as cornerstoneTools from '@cornerstonejs/tools';

const {
  WindowLevelTool,
  ToolGroupManager,
  Enums: csToolsEnums,
} = cornerstoneTools;

const { MouseBindings } = csToolsEnums;
const toolGroupId = 'STACK_TOOL_GROUP_ID';

// This is for debugging purposes
console.warn(
  'Click on index.ts to open source code for this example --------->'
);

const { ViewportType } = Enums;
const renderingEngineId = 'myRenderingEngine';
const viewportId = 'STACK_VP';

// ======== Set up page ======== //
setTitleAndDescription(
  'Sigmoid VOI Stack',
  'This example shows how to set a Sigmoid VOI on a Stack viewport.'
);

const content = document.getElementById('content');
const element = document.createElement('div');
element.id = 'cornerstone-element';
element.style.width = '500px';
element.style.height = '500px';

content.appendChild(element);
// ============================= //

addButtonToToolbar({
  title: 'Set Linear VOI',
  onClick: () => {
    // Get the rendering engine
    const renderingEngine = getRenderingEngine(renderingEngineId);

    // Get the stack viewport
    const viewport = renderingEngine.getViewport(
      viewportId
    ) as Types.IStackViewport;

    // Set a range to highlight bones
    viewport.setProperties({ VOILUTFunction: Enums.VOILUTFunctionType.LINEAR });

    viewport.render();
  },
});

addButtonToToolbar({
  title: 'Set Sigmoid VOI',
  onClick: () => {
    // Get the rendering engine
    const renderingEngine = getRenderingEngine(renderingEngineId);

    // Get the stack viewport
    const viewport = renderingEngine.getViewport(
      viewportId
    ) as Types.IStackViewport;

    // Set a range to highlight bones
    viewport.setProperties({
      VOILUTFunction: Enums.VOILUTFunctionType.SAMPLED_SIGMOID,
    });

    viewport.render();
  },
});

/**
 * Runs the demo
 */
async function run() {
  // Init Cornerstone and related libraries
  await initDemo();

  // Add tools to Cornerstone3D
  cornerstoneTools.addTool(WindowLevelTool);

  // Define a tool group, which defines how mouse events map to tool commands for
  // Any viewport using the group
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  // Add the tools to the tool group
  toolGroup.addTool(WindowLevelTool.toolName);

  // Set the initial state of the tools, here we set one tool active on left click.
  // This means left click will draw that tool.
  toolGroup.setToolActive(WindowLevelTool.toolName, {
    bindings: [
      {
        mouseButton: MouseBindings.Primary, // Left Click
      },
    ],
  });

  // Get Cornerstone imageIds and fetch metadata into RAM
  const imageIds = await createImageIdsAndCacheMetaData({
    StudyInstanceUID:
      '1.3.6.1.4.1.14519.5.2.1.4792.2001.105216574054253895819671475627',
    SeriesInstanceUID:
      '1.3.6.1.4.1.14519.5.2.1.4792.2001.210542687020950294776803479438',
    wadoRsRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
  });

  // Instantiate a rendering engine
  const renderingEngine = new RenderingEngine(renderingEngineId);

  toolGroup.addViewport(viewportId, renderingEngineId);

  // Create a stack viewport
  const viewportInput = {
    viewportId,
    type: ViewportType.STACK,
    element,
    defaultOptions: {
      background: [0.2, 0, 0.2] as Types.Point3,
    },
  };

  renderingEngine.enableElement(viewportInput);

  // Get the stack viewport that was created
  const viewport = renderingEngine.getViewport(
    viewportId
  ) as Types.IStackViewport;

  // Define a stack containing a single image
  const stack = [imageIds[0]];

  // Set the stack on the viewport
  await viewport.setStack(stack);

  // Render the image
  viewport.render();
}

run();
