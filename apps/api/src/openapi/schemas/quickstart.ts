import { z } from '@hono/zod-openapi';

/**
 * Schema for Bash setup script response.
 */
export const OpencodeBashScriptSchema = z
  .string()
  .openapi('OpencodeBashScript', {
    description: 'Bash installation and configuration script for Opencode on Linux/macOS',
  });

/**
 * Schema for PowerShell setup script response.
 */
export const OpencodePs1ScriptSchema = z
  .string()
  .openapi('OpencodePs1Script', {
    description: 'PowerShell installation and configuration script for Opencode on Windows',
  });
