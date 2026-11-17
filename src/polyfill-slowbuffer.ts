import * as buffer from 'buffer';

const nodeBuffer = buffer as typeof buffer & { SlowBuffer?: typeof Buffer };

if (typeof nodeBuffer.SlowBuffer === 'undefined') {
  nodeBuffer.SlowBuffer = Buffer;
}
