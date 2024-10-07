import { Injectable } from '@nestjs/common';
import { CreateFileDto } from './dto/create-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { User } from 'src/typeorm/entities/User';
import File from 'multer';
import { File as F } from 'src/typeorm/entities/File';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class FileService {

  constructor(@InjectRepository(F) private fileRepository: Repository<F>){}
  storeFile(fileData: File, visibility: 'private' | 'public', user: User) {
    const newFile = this.fileRepository.create({
      fileName: fileData.originalname,
      filePath: `uploads/${fileData.originalname}`,
      fileType: fileData.mimetype,
      fileSize: fileData.size,
      visibility,
      user,
    })
    return this.fileRepository.save(newFile);
  }

  findAll() {
    return `This action returns all file`;
  }

  findOne(id: number) {
    return `This action returns a #${id} file`;
  }

  update(id: number, updateFileDto: UpdateFileDto) {
    return `This action updates a #${id} file`;
  }

  remove(id: number) {
    return `This action removes a #${id} file`;
  }
}
