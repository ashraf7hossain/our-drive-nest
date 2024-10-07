import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileService } from './file.service';
import { CreateFileDto } from './dto/create-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { File } from 'multer';
import { JwtAuthGaurd } from '../auth/guards/jwt.gaurd';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { User } from 'src/typeorm/entities/User';

@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @UseGuards(JwtAuthGaurd)
  @Post('/upload')
  @UseInterceptors(FileInterceptor('file', { dest: './uploads' }))
  create(
    @UploadedFile() file: File,
    @Body('visibility') visibility: 'private' | 'public',
    @CurrentUser() user: User,
  ) {
    return this.fileService.storeFile(file, visibility, user);
  }

  @Get()
  findAll() {
    return this.fileService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fileService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateFileDto: UpdateFileDto) {
    return this.fileService.update(+id, updateFileDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.fileService.remove(+id);
  }
}
