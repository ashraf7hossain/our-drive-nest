import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import { RedisService } from 'src/redis/redis.service';
import { File as StoredFile } from 'src/typeorm/entities/File';
import { User } from 'src/typeorm/entities/User';
import { Repository } from 'typeorm';
import { InitUploadDto } from './dto/init-upload.dto';
import { FileService } from './file.service';
import { planChunk, readClientOffset } from './upload-chunk';
import {
  LOCK_TTL_SECONDS,
  MAX_CHUNK_SIZE,
  MAX_FILE_SIZE,
  RECOMMENDED_CHUNK_SIZE,
  UPLOAD_TTL_SECONDS,
} from './upload.constants';
import { UploadSession, UploadVisibility } from './upload-session';

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    @InjectRepository(StoredFile)
    private readonly fileRepository: Repository<StoredFile>,
    private readonly redis: RedisService,
    private readonly fileService: FileService,
  ) {}

  async onModuleInit() {
    await fs.mkdir(path.join(process.cwd(), 'uploads'), { recursive: true });
  }

  async init(dto: InitUploadDto, userId: number) {
    const meta = this.parseInit(dto);
    const uploadId = randomUUID();
    const paths = this.paths(uploadId, meta.fileName);
    const session: UploadSession = {
      uploadId,
      userId,
      fileName: meta.fileName,
      fileType: meta.fileType,
      fileSize: meta.fileSize,
      visibility: meta.visibility,
      offset: 0,
      tempPath: paths.tempPath,
      finalPath: paths.finalPath,
      publicPath: paths.publicPath,
      status: 'in_progress',
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(paths.tempPath), { recursive: true });
    await fs.mkdir(path.dirname(paths.finalPath), { recursive: true });

    if (meta.fileSize === 0) {
      await fs.writeFile(paths.finalPath, Buffer.alloc(0));
      await this.saveSession(session);
      return this.finish(session);
    }

    const handle = await fs.open(paths.tempPath, 'w');
    await handle.close();
    try {
      await this.saveSession(session);
    } catch (err) {
      await fs.unlink(paths.tempPath).catch(() => undefined);
      throw err;
    }

    return { ...this.view(session), file: null };
  }

  async status(uploadId: string, userId: number) {
    const lockKey = this.lockKey(uploadId);
    await this.acquire(lockKey);
    try {
      const session = await this.requireSession(uploadId, userId);
      if (
        session.status !== 'completed' &&
        session.offset === session.fileSize
      ) {
        return this.finish(session);
      }
      const file =
        session.status === 'completed'
          ? await this.loadPresented(session.fileId)
          : null;
      return { ...this.view(session), file };
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  async appendChunk(params: {
    uploadId: string;
    userId: number;
    uploadOffset?: string;
    contentRange?: string;
    req: Request;
  }) {
    const chunk = await readLimitedStream(params.req, MAX_CHUNK_SIZE);
    const lockKey = this.lockKey(params.uploadId);
    await this.acquire(lockKey);
    try {
      const session = await this.requireSession(params.uploadId, params.userId);
      if (session.status === 'completed') {
        return {
          ...this.view(session),
          file: await this.loadPresented(session.fileId),
        };
      }

      const parsed = readClientOffset(
        {
          uploadOffset: params.uploadOffset,
          contentRange: params.contentRange,
        },
        session.fileSize,
      );
      if ('error' in parsed) {
        throw new BadRequestException(parsed.error);
      }
      if (
        parsed.range &&
        chunk.length !== parsed.range.end - parsed.range.start + 1
      ) {
        throw new BadRequestException(
          'Body length does not match Content-Range',
        );
      }

      const plan = planChunk({
        sessionOffset: session.offset,
        clientOffset: parsed.offset,
        chunkLength: chunk.length,
        fileSize: session.fileSize,
      });
      if (plan.action === 'reject') {
        throw new HttpException(
          {
            statusCode: plan.status,
            message: plan.message,
            offset: plan.offset,
          },
          plan.status,
        );
      }

      if (plan.action === 'write') {
        const handle = await fs.open(session.tempPath, 'r+');
        try {
          await handle.write(chunk, 0, chunk.length, session.offset);
        } finally {
          await handle.close();
        }
        session.offset += chunk.length;
        await this.saveSession(session);
      }

      if (session.offset === session.fileSize) {
        return this.finish(session);
      }

      return { ...this.view(session), file: null };
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  async abort(uploadId: string, userId: number) {
    const lockKey = this.lockKey(uploadId);
    await this.acquire(lockKey);
    try {
      const session = await this.requireSession(uploadId, userId);
      if (session.status === 'completed') {
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: 'Upload already completed',
            fileId: session.fileId ?? null,
          },
          HttpStatus.CONFLICT,
        );
      }
      await fs.unlink(session.tempPath).catch(() => undefined);
      await this.redis.del(this.sessionKey(uploadId));
      return { uploadId, aborted: true };
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  private async finish(session: UploadSession) {
    if (session.status === 'completed' && session.fileId) {
      return {
        ...this.view(session),
        file: await this.loadPresented(session.fileId),
      };
    }

    try {
      await fs.access(session.finalPath);
    } catch {
      await fs.rename(session.tempPath, session.finalPath);
    }

    const stat = await fs.stat(session.finalPath);
    if (stat.size !== session.fileSize) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: 'Uploaded size does not match the declared file size',
          offset: session.offset,
        },
        HttpStatus.CONFLICT,
      );
    }

    let file = await this.fileRepository.findOne({
      where: { uploadId: session.uploadId },
      relations: ['user'],
    });
    if (!file) {
      file = await this.fileRepository.save(
        this.fileRepository.create({
          uploadId: session.uploadId,
          fileName: session.fileName,
          filePath: session.publicPath,
          fileType: session.fileType,
          fileSize: session.fileSize,
          visibility: session.visibility,
          user: { id: session.userId } as User,
        }),
      );
      file = await this.fileRepository.findOne({
        where: { id: file.id },
        relations: ['user'],
      });
    }

    session.status = 'completed';
    session.fileId = file.id;
    session.offset = session.fileSize;
    await this.saveSession(session);
    await this.fileService.invalidate();
    this.logger.log(`Upload ${session.uploadId} completed as file ${file.id}`);

    return { ...this.view(session), file: this.fileService.present(file) };
  }

  private async loadPresented(fileId?: number) {
    if (!fileId) return null;
    const file = await this.fileRepository.findOne({
      where: { id: fileId },
      relations: ['user'],
    });
    return file ? this.fileService.present(file) : null;
  }

  private view(session: UploadSession) {
    return {
      uploadId: session.uploadId,
      fileName: session.fileName,
      fileType: session.fileType,
      fileSize: session.fileSize,
      visibility: session.visibility,
      offset: session.offset,
      completed: session.status === 'completed',
      fileId: session.fileId ?? null,
      chunkSize: RECOMMENDED_CHUNK_SIZE,
    };
  }

  private async requireSession(uploadId: string, userId: number) {
    const session = await this.redis.getJson<UploadSession>(
      this.sessionKey(uploadId),
    );
    if (!session) {
      throw new NotFoundException('Upload session not found or expired');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('Upload belongs to another user');
    }
    return session;
  }

  private async saveSession(session: UploadSession) {
    await this.redis.setJson(
      this.sessionKey(session.uploadId),
      session,
      UPLOAD_TTL_SECONDS,
    );
  }

  private async acquire(lockKey: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await this.redis.acquireLock(lockKey, LOCK_TTL_SECONDS)) return;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        message: 'Upload is busy. Retry this request.',
      },
      HttpStatus.CONFLICT,
    );
  }

  private parseInit(dto: InitUploadDto): {
    fileName: string;
    fileSize: number;
    fileType: string;
    visibility: UploadVisibility;
  } {
    if (!dto || typeof dto.fileName !== 'string' || !dto.fileName.trim()) {
      throw new BadRequestException('fileName is required');
    }
    const fileSize = Number(dto.fileSize);
    if (
      !Number.isInteger(fileSize) ||
      fileSize < 0 ||
      fileSize > MAX_FILE_SIZE
    ) {
      throw new BadRequestException(
        `fileSize must be an integer between 0 and ${MAX_FILE_SIZE}`,
      );
    }
    if (
      typeof dto.fileType !== 'string' ||
      !dto.fileType.trim() ||
      dto.fileType.length > 255
    ) {
      throw new BadRequestException('fileType is required');
    }
    const visibility = dto.visibility ?? 'private';
    if (visibility !== 'private' && visibility !== 'public') {
      throw new BadRequestException('visibility must be private or public');
    }
    return {
      fileName: dto.fileName.trim(),
      fileSize,
      fileType: dto.fileType.trim(),
      visibility,
    };
  }

  private paths(uploadId: string, fileName: string) {
    const safe = safeFileName(fileName);
    const root = path.join(process.cwd(), 'uploads');
    return {
      tempPath: path.join(root, '.partials', uploadId),
      finalPath: path.join(root, `${uploadId}-${safe}`),
      publicPath: `uploads/${uploadId}-${safe}`,
    };
  }

  private sessionKey(uploadId: string) {
    return `upload:session:${uploadId}`;
  }

  private lockKey(uploadId: string) {
    return `upload:lock:${uploadId}`;
  }
}

function safeFileName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return (base || 'file').slice(0, 180);
}

function readLimitedStream(req: Request, maxBytes: number): Promise<Buffer> {
  if (req.readableEnded) {
    return Promise.resolve(Buffer.alloc(0));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        fail(
          new HttpException(
            {
              statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
              message: `Chunk exceeds ${maxBytes} bytes`,
            },
            HttpStatus.PAYLOAD_TOO_LARGE,
          ),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => fail(err));
    req.on('aborted', () =>
      fail(new BadRequestException('Upload chunk was aborted')),
    );
  });
}
