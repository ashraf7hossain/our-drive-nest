import { planChunk, readClientOffset } from './upload-chunk';

describe('planChunk', () => {
  it('writes when the client continues at the stored offset', () => {
    expect(
      planChunk({
        sessionOffset: 5,
        clientOffset: 5,
        chunkLength: 5,
        fileSize: 10,
      }),
    ).toEqual({ action: 'write' });
  });

  it('treats an exact retry of the previous chunk as a duplicate', () => {
    expect(
      planChunk({
        sessionOffset: 10,
        clientOffset: 5,
        chunkLength: 5,
        fileSize: 10,
      }),
    ).toEqual({ action: 'duplicate' });
  });

  it('rejects a gap so the client can resume from the stored offset', () => {
    expect(
      planChunk({
        sessionOffset: 5,
        clientOffset: 7,
        chunkLength: 1,
        fileSize: 10,
      }),
    ).toEqual({
      action: 'reject',
      status: 409,
      message: 'Offset mismatch. Resume from the current offset.',
      offset: 5,
    });
  });

  it('rejects a chunk that would run past the declared file size', () => {
    expect(
      planChunk({
        sessionOffset: 8,
        clientOffset: 8,
        chunkLength: 4,
        fileSize: 10,
      }).action,
    ).toBe('reject');
  });
});

describe('readClientOffset', () => {
  it('reads Upload-Offset', () => {
    expect(readClientOffset({ uploadOffset: '12' }, 100)).toEqual({
      offset: 12,
      range: undefined,
    });
  });

  it('reads Content-Range and checks the total size', () => {
    expect(readClientOffset({ contentRange: 'bytes 0-4/10' }, 10)).toEqual({
      offset: 0,
      range: { start: 0, end: 4, total: 10 },
    });
  });

  it('rejects a missing offset', () => {
    expect(readClientOffset({}, 10)).toEqual({
      error: 'Upload-Offset or Content-Range header is required',
    });
  });

  it('rejects headers that disagree', () => {
    expect(
      readClientOffset({ uploadOffset: '1', contentRange: 'bytes 0-4/10' }, 10),
    ).toEqual({ error: 'Upload-Offset does not match Content-Range' });
  });
});
