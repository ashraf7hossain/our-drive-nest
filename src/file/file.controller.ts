import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Request, Response } from 'express';
import { JwtAuthGaurd } from '../auth/guards/jwt.gaurd';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { FileService } from './file.service';
import { UpdateFileDto } from './dto/update-file.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { UploadService } from './upload.service';
import { UploadVisibility } from './upload-session';

type AuthUser = { id: number };

@Controller('files')
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly uploadService: UploadService,
  ) {}

  @UseGuards(JwtAuthGaurd)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { dest: './uploads' }))
  create(
    @UploadedFile()
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      path: string;
    },
    @Body('visibility') visibility: UploadVisibility,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fileService.storeFile(file, visibility, user);
  }

  @UseGuards(JwtAuthGaurd)
  @Post('uploads')
  async initUpload(
    @Body() body: InitUploadDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.uploadService.init(body, Number(user.id));
    this.setUploadHeaders(res, result);
    return result;
  }

  @UseGuards(JwtAuthGaurd)
  @Get('uploads/:uploadId')
  async uploadStatus(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.uploadService.status(uploadId, Number(user.id));
    this.setUploadHeaders(res, result);
    return result;
  }

  @UseGuards(JwtAuthGaurd)
  @Put('uploads/:uploadId')
  async appendChunk(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Headers('upload-offset') uploadOffset: string,
    @Headers('content-range') contentRange: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.uploadService.appendChunk({
      uploadId,
      userId: Number(user.id),
      uploadOffset,
      contentRange,
      req,
    });
    this.setUploadHeaders(res, result);
    return result;
  }

  @UseGuards(JwtAuthGaurd)
  @Delete('uploads/:uploadId')
  abortUpload(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.uploadService.abort(uploadId, Number(user.id));
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async findAll(
    @CurrentUser() user: AuthUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, cache } = await this.fileService.findAll(this.viewerId(user));
    res.setHeader('X-Cache', cache);
    return data;
  }

  @Get(':id/content')
  @UseGuards(OptionalJwtAuthGuard)
  async content(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data } = await this.fileService.findOne(id, this.viewerId(user));
    const absolute = this.fileService.readablePath(data.filePath);
    if (!absolute) {
      throw new NotFoundException(`File ${id} not found`);
    }
    const info = await stat(absolute).catch(() => null);
    if (!info) {
      throw new NotFoundException(`File ${id} not found`);
    }
    const encoded = encodeURIComponent(data.fileName);
    res.setHeader(
      'Content-Type',
      data.fileType || 'application/octet-stream',
    );
    res.setHeader('Content-Length', String(info.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
    );
    return new StreamableFile(createReadStream(absolute));
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, cache } = await this.fileService.findOne(
      id,
      this.viewerId(user),
    );
    res.setHeader('X-Cache', cache);
    return data;
  }

  @Patch(':id')
  @UseGuards(JwtAuthGaurd)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateFileDto: UpdateFileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fileService.update(id, updateFileDto, Number(user.id));
  }

  @Delete(':id')
  @UseGuards(JwtAuthGaurd)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.fileService.remove(id, Number(user.id));
  }

  private viewerId(user?: AuthUser) {
    if (!user || user.id === undefined || user.id === null) return null;
    const id = Number(user.id);
    return Number.isInteger(id) ? id : null;
  }

  private setUploadHeaders(
    res: Response,
    result: { offset: number; fileSize: number },
  ) {
    res.setHeader('Upload-Offset', String(result.offset));
    res.setHeader('Upload-Length', String(result.fileSize));
  }
}
