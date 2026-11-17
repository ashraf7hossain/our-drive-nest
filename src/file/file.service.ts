import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { RedisService } from 'src/redis/redis.service';
import { User } from 'src/typeorm/entities/User';
import { File as StoredFile } from 'src/typeorm/entities/File';
import { Repository } from 'typeorm';
import { UpdateFileDto } from './dto/update-file.dto';
import { FILE_CACHE_TTL_SECONDS } from './upload.constants';
import { UploadVisibility } from './upload-session';

type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
};

const FILE_CACHE_PREFIX = 'cache:files:';

@Injectable()
export class FileService {
  constructor(
    @InjectRepository(StoredFile)
    private readonly fileRepository: Repository<StoredFile>,
    private readonly redis: RedisService,
  ) {}

  async storeFile(
    fileData: UploadedFile,
    visibility: UploadVisibility,
    user: { id: number },
  ) {
    const saved = await this.fileRepository.save(
      this.fileRepository.create({
        fileName: fileData.originalname,
        filePath: this.relativeToCwd(fileData.path),
        fileType: fileData.mimetype,
        fileSize: fileData.size,
        visibility: visibility === 'public' ? 'public' : 'private',
        user: user as User,
      }),
    );
    await this.invalidate();
    return this.present(saved);
  }

  findAll(userId: number | null) {
    const key = userId
      ? `${FILE_CACHE_PREFIX}list:user:${userId}`
      : `${FILE_CACHE_PREFIX}list:public`;
    return this.redis.getOrSet(key, FILE_CACHE_TTL_SECONDS, async () => {
      const files = await this.fileRepository.find({
        relations: ['user'],
        order: { id: 'DESC' },
      });
      return files
        .filter((file) => this.canRead(file, userId))
        .map((file) => this.present(file));
    });
  }

  findOne(id: number, userId: number | null) {
    const key = userId
      ? `${FILE_CACHE_PREFIX}${id}:user:${userId}`
      : `${FILE_CACHE_PREFIX}${id}:public`;
    return this.redis.getOrSet(key, FILE_CACHE_TTL_SECONDS, async () => {
      const file = await this.fileRepository.findOne({
        where: { id },
        relations: ['user'],
      });
      if (!file || !this.canRead(file, userId)) {
        throw new NotFoundException(`File ${id} not found`);
      }
      return this.present(file);
    });
  }

  async update(id: number, updateFileDto: UpdateFileDto, userId: number) {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!file) {
      throw new NotFoundException(`File ${id} not found`);
    }
    this.assertOwner(file, userId);
    if (updateFileDto.fileName !== undefined) {
      if (
        typeof updateFileDto.fileName !== 'string' ||
        !updateFileDto.fileName.trim()
      ) {
        throw new BadRequestException('fileName cannot be empty');
      }
      file.fileName = updateFileDto.fileName.trim();
    }
    if (updateFileDto.visibility !== undefined) {
      if (
        updateFileDto.visibility !== 'private' &&
        updateFileDto.visibility !== 'public'
      ) {
        throw new BadRequestException('visibility must be private or public');
      }
      file.visibility = updateFileDto.visibility;
    }
    const saved = await this.fileRepository.save(file);
    await this.invalidate();
    return this.present(saved);
  }

  async remove(id: number, userId: number) {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!file) {
      throw new NotFoundException(`File ${id} not found`);
    }
    this.assertOwner(file, userId);
    await this.fileRepository.delete(id);
    const stored = this.resolveStoredPath(file.filePath);
    if (stored) {
      await fs.unlink(stored).catch(() => undefined);
    }
    await this.invalidate();
    return { id, deleted: true };
  }

  present(file: StoredFile) {
    const owner = file.user;
    return {
      id: file.id,
      uploadId: file.uploadId ?? null,
      visibility: file.visibility,
      fileName: file.fileName,
      filePath: file.filePath,
      fileType: file.fileType,
      fileSize: Number(file.fileSize),
      user: owner
        ? { id: owner.id, username: owner.username, email: owner.email }
        : null,
    };
  }

  async invalidate() {
    await this.redis.delByPrefix(FILE_CACHE_PREFIX);
  }

  private canRead(file: StoredFile, userId: number | null) {
    return file.visibility === 'public' || file.user?.id === userId;
  }

  private assertOwner(file: StoredFile, userId: number) {
    if (file.user?.id !== userId) {
      throw new ForbiddenException('You do not own this file');
    }
  }

  private relativeToCwd(filePath: string) {
    const normalized = path.normalize(filePath);
    const relative = path.isAbsolute(normalized)
      ? path.relative(process.cwd(), normalized)
      : normalized;
    return relative.split(path.sep).join('/');
  }

  readablePath(filePath: string) {
    return this.resolveStoredPath(filePath);
  }

  private resolveStoredPath(filePath: string) {
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const resolved = path.resolve(process.cwd(), filePath);
    const relative = path.relative(uploadsRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return resolved;
  }
}
