import {
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthPayloadDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import { RegisterUserPayloadDto } from './dto/register.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/typeorm/entities/User';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    @InjectRepository(User) private userRepository: Repository<User>,
  ) {}

  async register(registerUserPayloadDto: RegisterUserPayloadDto) {
    const newUser = this.userRepository.create(registerUserPayloadDto);
    return this.userRepository.save(newUser);
  }

  async validateUsr({ username, password }: AuthPayloadDto) {
    const findUser = await this.userRepository.findOne({ where: { username } });
    if (!findUser || findUser.password !== password) {
      return null;
    }
    const { password: _, ...user } = findUser;
    return this.jwtService.sign(user);
  }
}
