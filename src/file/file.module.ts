import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { File } from 'src/typeorm/entities/File';

@Module({
  imports: [
    TypeOrmModule.forFeature([File]),
  ],
  controllers: [FileController],
  providers: [FileService],
})
export class FileModule {}
