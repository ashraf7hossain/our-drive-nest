export type ChunkPlan =
  | { action: 'write' }
  | { action: 'duplicate' }
  | { action: 'reject'; status: number; message: string; offset?: number };

export type ContentRange = { start: number; end: number; total: number };

export type ClientOffset =
  | { offset: number; range?: ContentRange }
  | { error: string };

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;

export function parseContentRange(header: string): ContentRange | null {
  const match = CONTENT_RANGE.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (end < start) return null;
  return { start, end, total };
}

/**
 * `offset` is the next byte the server expects. A retry of the last chunk
 * (client offset + length === server offset) is a duplicate, not a gap.
 */
export function planChunk(input: {
  sessionOffset: number;
  clientOffset: number;
  chunkLength: number;
  fileSize: number;
}): ChunkPlan {
  const { sessionOffset, clientOffset, chunkLength, fileSize } = input;

  if (
    !Number.isInteger(clientOffset) ||
    clientOffset < 0 ||
    !Number.isInteger(chunkLength) ||
    chunkLength < 0
  ) {
    return {
      action: 'reject',
      status: 400,
      message: 'Invalid upload offset or chunk length',
      offset: sessionOffset,
    };
  }

  if (clientOffset > fileSize || clientOffset + chunkLength > fileSize) {
    return {
      action: 'reject',
      status: 400,
      message: 'Chunk exceeds declared file size',
      offset: sessionOffset,
    };
  }

  if (clientOffset === sessionOffset) {
    if (chunkLength === 0) {
      return {
        action: 'reject',
        status: 400,
        message: 'Empty chunk',
        offset: sessionOffset,
      };
    }
    return { action: 'write' };
  }

  if (
    clientOffset < sessionOffset &&
    clientOffset + chunkLength === sessionOffset
  ) {
    return { action: 'duplicate' };
  }

  return {
    action: 'reject',
    status: 409,
    message: 'Offset mismatch. Resume from the current offset.',
    offset: sessionOffset,
  };
}

export function readClientOffset(
  headers: { uploadOffset?: string; contentRange?: string },
  fileSize: number,
): ClientOffset {
  const uploadOffset =
    headers.uploadOffset !== undefined && headers.uploadOffset !== ''
      ? Number(headers.uploadOffset)
      : undefined;
  const range = headers.contentRange
    ? parseContentRange(headers.contentRange)
    : undefined;

  if (headers.contentRange && !range) {
    return { error: 'Content-Range must look like bytes start-end/total' };
  }

  if (uploadOffset !== undefined && !Number.isInteger(uploadOffset)) {
    return { error: 'Upload-Offset must be an integer' };
  }

  if (range && uploadOffset !== undefined && uploadOffset !== range.start) {
    return { error: 'Upload-Offset does not match Content-Range' };
  }

  if (range && range.total !== fileSize) {
    return {
      error: 'Content-Range total does not match the declared file size',
    };
  }

  if (uploadOffset !== undefined) {
    return { offset: uploadOffset, range: range || undefined };
  }

  if (range) {
    return { offset: range.start, range };
  }

  return { error: 'Upload-Offset or Content-Range header is required' };
}
