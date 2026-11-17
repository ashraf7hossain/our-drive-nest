import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RedisService } from '../redis/redis.service';
import { File } from '../typeorm/entities/File';
import { FileService } from './file.service';

describe('FileService', () => {
  let service: FileService;
  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const redis = {
    getOrSet: jest.fn(),
    delByPrefix: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        { provide: getRepositoryToken(File), useValue: repository },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<FileService>(FileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns a cached file list without querying the database', async () => {
    redis.getOrSet.mockResolvedValue({
      data: [{ id: 1, fileName: 'a.txt' }],
      cache: 'HIT',
    });

    await expect(service.findAll(null)).resolves.toEqual({
      data: [{ id: 1, fileName: 'a.txt' }],
      cache: 'HIT',
    });
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('loads files from the database on a cache miss', async () => {
    redis.getOrSet.mockImplementation(async (_key, _ttl, loader) => ({
      data: await loader(),
      cache: 'MISS',
    }));
    repository.find.mockResolvedValue([
      {
        id: 4,
        uploadId: null,
        visibility: 'public',
        fileName: 'notes.txt',
        filePath: 'uploads/notes.txt',
        fileType: 'text/plain',
        fileSize: 12,
        user: {
          id: 2,
          username: 'ada',
          email: 'ada@example.com',
          password: 'secret',
        },
      },
    ]);

    const result = await service.findAll(null);

    expect(result.cache).toBe('MISS');
    expect(result.data).toEqual([
      {
        id: 4,
        uploadId: null,
        visibility: 'public',
        fileName: 'notes.txt',
        filePath: 'uploads/notes.txt',
        fileType: 'text/plain',
        fileSize: 12,
        user: { id: 2, username: 'ada', email: 'ada@example.com' },
      },
    ]);
  });

  it('drops list and item cache keys after a file is removed', async () => {
    repository.findOne.mockResolvedValue({
      id: 3,
      filePath: 'uploads/3-a.txt',
      user: { id: 8 },
    });
    repository.delete.mockResolvedValue(undefined);

    await expect(service.remove(3, 8)).resolves.toEqual({
      id: 3,
      deleted: true,
    });
    expect(redis.delByPrefix).toHaveBeenCalledWith('cache:files:');
  });

  it('hides private files from anonymous readers and shows them to the owner', async () => {
    redis.getOrSet.mockImplementation(async (_key, _ttl, loader) => ({
      data: await loader(),
      cache: 'MISS',
    }));
    repository.find.mockResolvedValue([
      {
        id: 1,
        uploadId: null,
        visibility: 'private',
        fileName: 'secret.txt',
        filePath: 'uploads/secret.txt',
        fileType: 'text/plain',
        fileSize: 1,
        user: { id: 9, username: 'ada', email: 'ada@example.com' },
      },
      {
        id: 2,
        uploadId: null,
        visibility: 'public',
        fileName: 'open.txt',
        filePath: 'uploads/open.txt',
        fileType: 'text/plain',
        fileSize: 1,
        user: { id: 9, username: 'ada', email: 'ada@example.com' },
      },
    ]);

    const anonymous = await service.findAll(null);
    const owner = await service.findAll(9);

    expect(anonymous.data.map((file) => file.id)).toEqual([2]);
    expect(owner.data.map((file) => file.id)).toEqual([1, 2]);
  });
});
