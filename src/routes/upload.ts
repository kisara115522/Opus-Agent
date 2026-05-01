/**
 * File Upload Routes - ported from Java FileUploadController.java
 *
 * Endpoints:
 * - POST /api/upload  - Upload a file and optionally index it for RAG
 */

import { Hono } from 'hono';
import pino from 'pino';
import { writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { successResponse, errorResponse } from '../types/common.js';

const logger = pino({ name: 'upload-routes' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileUploadResult {
  fileName: string;
  filePath: string;
  fileSize: number;
}

export interface UploadRouteDeps {
  config: {
    file: {
      upload: {
        path: string;
        allowedExtensions: string[];
      };
    };
  };
  indexFile?: (filePath: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createUploadRoutes(deps: UploadRouteDeps): Hono {
  const { config, indexFile } = deps;
  const routes = new Hono();

  /**
   * POST /upload - Upload a file
   */
  routes.post('/upload', async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body['file'];

      if (!file || !(file instanceof File)) {
        return c.json(errorResponse('文件不能为空', 400), 400);
      }

      const originalName = file.name;
      if (!originalName) {
        return c.json(errorResponse('文件名不能为空', 400), 400);
      }

      // Validate extension
      const ext = extname(originalName).toLowerCase().replace('.', '');
      const allowedExts = config.file.upload.allowedExtensions;
      if (allowedExts.length > 0 && !allowedExts.includes(ext)) {
        return c.json(
          errorResponse(`不支持的文件格式，仅支持: ${allowedExts.join(',')}`, 400),
          400,
        );
      }

      // Ensure upload directory exists
      const uploadDir = resolve(config.file.upload.path);
      await mkdir(uploadDir, { recursive: true });

      // Use original filename (overwrite if exists, matching Java behavior)
      const filePath = resolve(uploadDir, originalName);

      // Write file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await writeFile(filePath, buffer);

      logger.info({ filePath, size: buffer.length }, '文件上传成功');

      // Index file for RAG (non-blocking, matches Java behavior)
      if (indexFile) {
        try {
          logger.info({ filePath }, '开始为上传文件创建向量索引');
          await indexFile(filePath);
          logger.info({ filePath }, '向量索引创建成功');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ filePath, error: message }, '向量索引创建失败（文件上传仍成功）');
        }
      }

      const result: FileUploadResult = {
        fileName: originalName,
        filePath,
        fileSize: buffer.length,
      };

      return c.json(successResponse(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, '文件上传失败');
      return c.json(errorResponse(`文件上传失败: ${message}`, 500), 500);
    }
  });

  return routes;
}
