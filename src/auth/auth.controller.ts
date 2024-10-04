import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { LocalGaurd } from './guards/local.gaurd';
import { JwtAuthGaurd } from './guards/jwt.gaurd';


@Controller('auth')
export class AuthController {
  constructor() {}

  @Post('login')
  @UseGuards(LocalGaurd)
  login(@Req() req: Request) {
    return req.user;
  }

  @Get('status')
  @UseGuards(JwtAuthGaurd)
  status(@Req() req: Request) {
    console.log("inside auth controller status");
    console.log(req?.user);
    return req?.user;
  }
}
