import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthPayloadDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';

const fakeUsers = [
  { id: 1, username: 'admin', password: 'admin' },
  { id: 2, username: 'user', password: 'user' },
  { id: 3, username: 'guest', password: 'guest' },
];
@Injectable()
export class AuthService {

  constructor(private jwtService: JwtService) {}
  getHello(): string {
    return 'Hello World!';
  }

  validateUsr({ username, password }: AuthPayloadDto) {
    const findUser = fakeUsers.find(
      (user) => user.username === username,
    );
    if(!findUser){
      return null;
    }
    if(findUser.password === password){
      const { password, ...user } = findUser;
      return this.jwtService.sign(user);
    }
  }
}
