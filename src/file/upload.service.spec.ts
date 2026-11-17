import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter } from 'events';
import { Request } from 'express';
import { promises as fs } from 'fs';
import { RedisService } from '../redis/redis.service';
import { File } from '../typeorm/entities/File';
import { FileService } from './file.service';
import { UploadService } from './upload.service';

function chunkRequest(body: Buffer) {
  const req = new EventEmitter() as Request;
  req.destroy = jest.fn() as Request['destroy'];
  process.nextTick(() => {
    req.emit('data', body);
    req.emit('end');
  });
  return req;
}

describe('UploadService', () => {
  let service: UploadService;
  const repository = {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
  };
  const redis = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn(),
    del: jest.fn(),
  };
  const fileService = {
    present: jest.fn((file) => ({ id: file.id, fileName: file.fileName })),
    invalidate: jest.fn(),
  };
  const session = {
    uploadId: '11111111-1111-4111-8111-111111111111',
    userId: 7,
    fileName: 'notes.txt',
    fileType: 'text/plain',
    fileSize: 4,
    visibility: 'private' as const,
    offset: 0,
    tempPath: 'uploads/.partials/11111111-1111-4111-8111-111111111111',
    finalPath: 'uploads/11111111-1111-4111-8111-111111111111-notes.txt',
    publicPath: 'uploads/11111111-1111-4111-8111-111111111111-notes.txt',
    status: 'in_progress' as const,
    createdAt: new Date(0).toISOString(),
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    redis.acquireLock.mockResolvedValue(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        { provide: getRepositoryToken(File), useValue: repository },
        { provide: RedisService, useValue: redis },
        { provide: FileService, useValue: fileService },
      ],
    }).compile();
    service = module.get(UploadService);
  });

  it('rejects a chunk that does not continue from the stored offset', async () => {
    jest.spyOn(fs, 'open');
    redis.getJson.mockResolvedValue({ ...session, offset: 0 });

    await expect(
      service.appendChunk({
        uploadId: session.uploadId,
        userId: 7,
        uploadOffset: '2',
        req: chunkRequest(Buffer.from('no')),
      }),
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        offset: 0,
      },
    });
    expect(fs.open).not.toHaveBeenCalled();
  });

  it('writes the next chunk and finishes the file when the last byte arrives', async () => {
    redis.getJson.mockResolvedValue({ ...session });
    const handle = {
      write: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(fs, 'open').mockResolvedValue(handle as never);
    jest.spyOn(fs, 'access').mockRejectedValue(new Error('missing'));
    jest.spyOn(fs, 'rename').mockResolvedValue(undefined);
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 4 } as never);
    repository.save.mockImplementation(async (value) => ({ ...value, id: 9 }));
    repository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 9, fileName: 'notes.txt' });

    const result = await service.appendChunk({
      uploadId: session.uploadId,
      userId: 7,
      uploadOffset: '0',
      req: chunkRequest(Buffer.from('test')),
    });

    expect(handle.write).toHaveBeenCalledWith(Buffer.from('test'), 0, 4, 0);
    expect(fs.rename).toHaveBeenCalledWith(session.tempPath, session.finalPath);
    expect(fileService.invalidate).toHaveBeenCalled();
    expect(result).toMatchObject({
      uploadId: session.uploadId,
      offset: 4,
      completed: true,
      file: { id: 9, fileName: 'notes.txt' },
    });
  });
});
