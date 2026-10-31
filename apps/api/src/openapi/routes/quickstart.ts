import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import { handleOpencodeBash, handleOpencodePs1 } from '../../routes/quickstart';
import { OpencodeBashScriptSchema, OpencodePs1ScriptSchema } from '../schemas/quickstart';

/**
 * Route definition for downloading Opencode setup script on Linux/macOS.
 */
export const opencodeBashRoute = createRoute({
  method: 'get',
  path: '/quickstart/opencode.sh',
  tags: ['Quickstart'],
  summary: 'Opencode Setup Script (Bash)',
  description:
    'Downloads a dynamically configured bash script for installing and setting up Opencode CLI on Linux/macOS with Morphic AI Gateway.',
  responses: {
    200: {
      description: 'Bash installation and configuration script stream',
      headers: z.object({
        'Content-Type': z.string().openapi({ example: 'text/x-shellscript; charset=utf-8' }),
        'Cache-Control': z.string().openapi({ example: 'private, no-store' }),
      }),
      content: {
        'text/x-shellscript': {
          schema: OpencodeBashScriptSchema,
        },
      },
    },
  },
});

/**
 * Route definition for downloading Opencode setup script on Windows PowerShell.
 */
export const opencodePs1Route = createRoute({
  method: 'get',
  path: '/quickstart/opencode.ps1',
  tags: ['Quickstart'],
  summary: 'Opencode Setup Script (PowerShell)',
  description:
    'Downloads a dynamically configured PowerShell script for installing and setting up Opencode CLI on Windows with Morphic AI Gateway.',
  responses: {
    200: {
      description: 'PowerShell installation and configuration script stream',
      headers: z.object({
        'Content-Type': z.string().openapi({ example: 'text/plain; charset=utf-8' }),
        'Cache-Control': z.string().openapi({ example: 'private, no-store' }),
      }),
      content: {
        'text/plain': {
          schema: OpencodePs1ScriptSchema,
        },
      },
    },
  },
});

/**
 * OpenAPI sub-router for Quickstart endpoints.
 */
export const quickstartOpenApiRouter = new OpenAPIHono();

quickstartOpenApiRouter.openapi(
  opencodeBashRoute,
  handleOpencodeBash as unknown as () => RouteConfigToTypedResponse<typeof opencodeBashRoute>,
);

quickstartOpenApiRouter.openapi(
  opencodePs1Route,
  handleOpencodePs1 as unknown as () => RouteConfigToTypedResponse<typeof opencodePs1Route>,
);
